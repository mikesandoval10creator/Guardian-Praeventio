// ARCHIVED AUDIT — PASS may reproduce an unfixed defect. NOT a release gate.
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,act,waitFor,cleanup,within} from '@testing-library/react';
import {OperationalChanges} from '@guardian-audit/src/pages/OperationalChanges';
import {declareChange,submitForReview} from '@guardian-audit/src/services/changeMgmt/operationalChangeService';
let project={id:'A',name:'Alpha'};
let user:any={uid:'hse',customClaims:{role:'prevencionista'}};
let cb:any;
const decide=vi.hoisted(()=>vi.fn(async()=>({})));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(k,f)=>typeof f==='string'?f:(f?.defaultValue??k)})}));
vi.mock('@guardian-audit/src/contexts/FirebaseContext',()=>({useFirebase:()=>({user,userRole:'prevencionista'})}));
vi.mock('@guardian-audit/src/contexts/ProjectContext',()=>({useProject:()=>({selectedProject:project})}));
vi.mock('@guardian-audit/src/services/changeMgmt/operationalChangeStore',()=>({subscribeChanges:(pid,next)=>{cb=next;return vi.fn();}}));
vi.mock('@guardian-audit/src/services/changeMgmt/operationalChangeApi',()=>({declareChangeApi:vi.fn(),acknowledgeChangeApi:vi.fn(),submitChangeApi:vi.fn(),decideChangeApi:decide,activateChangeApi:vi.fn(),verifyChangeApi:vi.fn(),revertChangeApi:vi.fn()}));
afterEach(()=>{cleanup();decide.mockClear();});
function fixture(){return submitForReview(declareChange({projectId:'A',kind:'procedure',whatChanged:'Cambiar procedimiento de izaje',previousValue:'v1',newValue:'v2',rationale:'Validación preventiva del procedimiento',impact:'low',affectedWorkerUids:[],declaredByUid:'creator',declaredByRole:'supervisor',effectiveFrom:'2026-05-25T08:00:00Z',now:new Date('2026-05-24T10:00:00Z')}),'creator',new Date('2026-05-24T11:00:00Z'));}
it('approval modal of A survives B and sends A change ID with B project',async()=>{
 project={id:'A',name:'Alpha'};user={uid:'hse',customClaims:{role:'prevencionista'}};
 const change=fixture();const view=render(<OperationalChanges/>);act(()=>cb([change]));
 fireEvent.click(screen.getByRole('button',{name:'Aprobar'}));
 expect(screen.getByRole('dialog')).toBeTruthy();
 project={id:'B',name:'Beta'};view.rerender(<OperationalChanges/>);
 const modal=screen.getByRole('dialog');fireEvent.change(within(modal).getByRole('textbox'),{target:{value:'Aprobación válida para el proyecto Alpha'}});
 fireEvent.click(within(modal).getByRole('button',{name:'Aprobar'}));
 await waitFor(()=>expect(decide).toHaveBeenCalledWith('B',change.id,{decision:'approved',comment:'Aprobación válida para el proyecto Alpha'}));
});
it('normal Firebase User shape with token role but no customClaims field hides approval',()=>{
 project={id:'A',name:'Alpha'};user={uid:'hse',getIdTokenResult:async()=>({claims:{role:'prevencionista'}})};
 render(<OperationalChanges/>);act(()=>cb([fixture()]));
 expect(screen.queryByRole('button',{name:'Aprobar'})).toBeNull();
});
