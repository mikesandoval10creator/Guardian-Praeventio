import { describe, it, expect } from 'vitest';
import { localProjectTextContext } from './textQueryContext';

describe('experimental local project text context', () => {
  it('tells the model that even an empty projection is only a partial client snapshot', () => {
    const projection=JSON.parse(localProjectTextContext('altura',[],'p1').context).projection;
    expect(projection).toEqual({coverage:'partial-client-snapshot',candidateLimit:500,recordLimit:5,truncated:false});
  });
  it.each(['', '!!!', '  ', 'sincoincidencia'])('returns no invented match for %j', query => {
    expect(localProjectTextContext(query,[{id:'own',projectId:'p1',title:'altura'}],'p1').selectedCount).toBe(0);
  });
  it('does not scan records without an exact selected project', () => {
    const guarded={get projectId(){throw new Error('should-not-read');}};
    expect(localProjectTextContext('altura',[guarded]).selectedCount).toBe(0);
    expect(localProjectTextContext('altura',[{id:'own',projectId:'p1',title:'altura'}],' p1').selectedCount).toBe(0);
  });
  it('omits oversized fields/IDs and malformed records without mutating the snapshot', () => {
    const record=Object.freeze({id:'own',projectId:'p1',title:'altura',description:'private-large-marker'.repeat(1000)});
    const input=Object.freeze([null,42,{}, {id:17,projectId:'p1'}, {id:'x'.repeat(1501),projectId:'p1',title:'altura'}, record]);const before=JSON.stringify(input);
    const result=localProjectTextContext('altura',input,'p1');expect(JSON.parse(result.context).records).toEqual([{id:'own',title:'altura',description:'',type:''}]);expect(result.truncated).toBe(true);expect(JSON.stringify(input)).toBe(before);
  });
  it('keeps UTF-16 cuts scalar-safe and exposes a truncated query-term projection', () => {
    const result=localProjectTextContext('altura',[{id:'own',projectId:'p1',title:'altura '+'😀'.repeat(100)}],'p1');const title=JSON.parse(result.context).records[0].title;expect(title.length).toBeLessThanOrEqual(200);expect(/[\uD800-\uDBFF]$/.test(title)).toBe(false);
    const query=Array.from({length:64},(_,i)=>'noise'+i).join(' ')+' altura';const limited=localProjectTextContext(query,[{id:'own',projectId:'p1',title:'altura'}],'p1');expect(limited.selectedCount).toBe(0);expect(limited.truncated).toBe(true);expect(localProjectTextContext('x'.repeat(16385),[],'p1').truncated).toBe(true);
  });
  it('deduplicates literal IDs after scope and bounds eligible candidates before text reads', () => {
    const own={id:'shared',projectId:'p1',title:'altura'};
    const duplicate=localProjectTextContext('altura',[{...own,projectId:'p2',description:'foreign'},own,own],'p1');expect(duplicate.selectedCount).toBe(1);
    const foreign=Array.from({length:600},(_,i)=>({id:'foreign-'+i,projectId:'p2',title:'altura'}));
    const eligible=Array.from({length:500},(_,i)=>({id:'own-'+i,projectId:'p1',title:'ruido'}));
    const beyond={id:'beyond',projectId:'p1',get title(){throw new Error('read-beyond-budget');}};
    const limited=localProjectTextContext('altura',[...foreign,...eligible,beyond],'p1');expect(limited.selectedCount).toBe(0);expect(limited.truncated).toBe(true);
    const afterForeign=localProjectTextContext('altura',[...foreign,own],'p1');expect(afterForeign.selectedCount).toBe(1);
  });
  it('bounds complete JSON and record count without cutting source IDs', () => {
    const many=Array.from({length:8},(_,i)=>({id:'record-'+i,projectId:'p1',title:'altura'}));
    const five=localProjectTextContext('altura',many,'p1');expect(five.selectedCount).toBe(5);expect(five.truncated).toBe(true);
    const over={id:'\u0000'.repeat(1000),projectId:'p1',title:'altura'};
    const bounded=localProjectTextContext('altura',[over,...many.map(n=>({...n,id:n.id+'x'.repeat(1200),description:'d'.repeat(600)}))],'p1');
    expect(bounded.context.length).toBeLessThanOrEqual(4000);expect(bounded.selectedCount).toBeGreaterThan(0);expect(bounded.truncated).toBe(true);
    const records=JSON.parse(bounded.context).records;expect(records.some((r:{id:string})=>r.id===over.id)).toBe(false);for(const r of records)expect(many.some(n=>r.id===n.id+'x'.repeat(1200))).toBe(true);
  });
  it('redacts text before the title/description/type caps without rewriting IDs', () => {
    const email = 'fixture' + '@' + 'example.invalid';
    const result = localProjectTextContext('altura', [{id:'literal/id',projectId:'p1',title:'altura '+'x'.repeat(190)+' '+email,description:'altura '+'x'.repeat(590)+' '+email,type:'x'.repeat(78)+email}], 'p1');
    const record=JSON.parse(result.context).records[0];
    expect(record.id).toBe('literal/id');expect(record.title.length).toBeLessThanOrEqual(200);expect(record.description.length).toBeLessThanOrEqual(600);expect(record.type.length).toBeLessThanOrEqual(80);expect(JSON.stringify(record)).not.toContain('fi');expect(result.truncated).toBe(true);
  });
  it('ranks normalized lexical terms with deterministic literal-ID ties', () => {
    const result = localProjectTextContext('ALTÚRA, caídas altura', [
      {id:'desc',projectId:'p1',title:'Plan',description:'caidas'},
      {id:'b',projectId:'p1',title:'Altura'},
      {id:'a',projectId:'p1',title:'ALTURA'},
      {id:'noise',projectId:'p1',title:'Ruido'},
    ], 'p1');
    expect(JSON.parse(result.context).records.map((r:{id:string})=>r.id)).toEqual(['a','b','desc']);
  });
  it('selects a matching project record without projecting unrelated metadata', () => {
    const result = localProjectTextContext('altura', [
      { id: 'foreign', projectId: 'p2', title: 'Altura', description: 'foreign-marker', type: 'risk' },
      { id: 'legacy', title: 'Altura', description: 'legacy-marker', type: 'risk' },
      { id: 'literal/id', projectId: 'p1', title: 'Altura', description: 'Usar protección colectiva', type: 'risk', creatorUid: 'private-marker' },
    ], 'p1');
    expect(JSON.parse(result.context)).toEqual({
      source: 'local-project-records', method: 'lexical-experimental',
      projection: {coverage:'partial-client-snapshot',candidateLimit:500,recordLimit:5,truncated:false},
      records: [{ id: 'literal/id', title: 'Altura', description: 'Usar protección colectiva', type: 'risk' }],
    });
    expect(result.selectedCount).toBe(1);
    expect(result.context).not.toMatch(/foreign-marker|legacy-marker|private-marker/);
  });
});
