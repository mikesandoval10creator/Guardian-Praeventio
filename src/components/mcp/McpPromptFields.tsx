import React,{useId} from 'react';
import type {PromptFields,PromptName} from './promptForm';
export function McpPromptFields({name,values,onChange}:{name:PromptName;values:PromptFields;onChange:(next:PromptFields)=>void}){
 const id=useId();
 const field=(key:keyof PromptFields,label:string,options:{max?:number;multiline?:boolean;numeric?:boolean}={})=>{
  const props={id:`${id}-${key}`,value:values[key],maxLength:options.max??3000,onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>onChange({...values,[key]:e.target.value}),className:'block w-full rounded border p-2 bg-surface'};
  return <div key={key}><label htmlFor={props.id}>{label}</label>{options.multiline?<textarea {...props} rows={3}/>:<input {...props} type="text" inputMode={options.numeric?'decimal':'text'}/>}</div>;
 };
 switch(name){
  case 'guardian.queryBCN':return <div>{field('question','Pregunta normativa',{max:2000,multiline:true})}</div>;
  case 'guardian.getChatResponse':return <div>
   {field('question','Mensaje para el chat',{multiline:true})}
   <label htmlFor={`${id}-detail`}>Nivel de detalle</label><select id={`${id}-detail`} value={values.detail} onChange={e=>onChange({...values,detail:e.target.value})} className="block rounded border p-2 bg-surface"><option value="1">Breve</option><option value="2">Intermedio</option><option value="3">Ampliado</option></select>
   <label htmlFor={`${id}-domain`}>Dominio de consulta</label><select id={`${id}-domain`} value={values.domain} onChange={e=>onChange({...values,domain:e.target.value})} className="block rounded border p-2 bg-surface"><option value="general">General</option><option value="sst">Seguridad y salud laboral</option><option value="ergonomia">Ergonomía</option><option value="medicina">Medicina consultiva</option><option value="emergencias">Emergencias consultivas</option></select>
   <p>El contexto lo resuelve el servidor. No se inicia historial automático ni se ejecuta el modelo.</p>
  </div>;
  case 'guardian.getSafetyAdvice':return <div>
   <p>Todos los campos son opcionales. Vacío significa sin medición, no cero. Usa punto decimal; temperatura −100 a 100 °C, UV 0 a 30. No se verifica un sensor.</p>
   {field('temperature','Temperatura medida (°C)',{max:32,numeric:true})}{field('uv','Índice UV medido',{max:32,numeric:true})}{field('airQuality','Observación de calidad del aire',{max:100,multiline:true})}
  </div>;
  case 'guardian.calculateStructuralLoad':return <div>
   {field('element','Elemento estructural')}{field('specs','Especificaciones y condiciones',{multiline:true})}
   <p>Solo prepara una consulta. No calcula ni certifica capacidad de carga y no autoriza uso o trabajo.</p>
  </div>;
  case 'guardian.designHazmatStorage':return <div>
   {field('storageType','Tipo de almacenamiento y unidad declarada')}{field('volume','Cantidad declarada',{max:32,numeric:true})}{field('materialClass','Clase de sustancia (NCh382)')}
   <p>Cantidad positiva, hasta 1 000 000 000, con punto decimal. La plantilla heredada dice toneladas/litros: declara la unidad en el tipo de almacenamiento. No inferimos unidades ni convertimos cantidades. Requiere revisión profesional.</p>
  </div>;
  case 'guardian.evaluateMinsalCompliance':return <div>
   {field('protocol','Protocolo MINSAL a revisar')}{field('observations','Observaciones del proyecto',{max:4000,multiline:true})}{field('industry','Sector o industria',{max:300})}
   <p>Observaciones y sector son opcionales; vacío no acredita ausencia de riesgos. Esto no certifica cumplimiento.</p>
  </div>;
 }
}
