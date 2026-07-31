import { readFile } from "node:fs/promises";
const roles=["superAdmin","uehOperator","hamOperator","reviewer","interviewer","mentor","mentee"];
const fixtureNames=["uehSeasonA","uehSeasonB","hamSeasonA"];
const results=[];const emit=(pass,reason)=>{process.stdout.write(JSON.stringify({pass,reason,results}));if(!pass)process.exitCode=1};
const ci=process.argv.indexOf("--config");if(ci<0||!process.argv[ci+1])emit(false,"missing_config");else{
 let c;try{c=JSON.parse(await readFile(process.argv[ci+1],"utf8"))}catch{emit(false,"invalid_config")}
 if(c){const identities=roles.map(r=>c.identities?.[r]);const tokens=identities.map(v=>v?.token);const valid=typeof c.endpoint==="string"&&c.endpoint.length>0&&typeof c.anonKey==="string"&&c.anonKey.length>0&&identities.every(v=>typeof v?.token==="string"&&v.token.length>20&&v.token.split(".").length===3&&typeof v?.userId==="string"&&v.userId.length>0)&&new Set(tokens).size===tokens.length&&fixtureNames.every(k=>typeof c.fixtures?.[k]==="string"&&c.fixtures[k].length>0)&&new Set(fixtureNames.map(k=>c.fixtures[k])).size===fixtureNames.length;
 if(!valid)emit(false,"missing_duplicate_or_malformed_identity_or_fixture");else{
  const call=async(path,token)=>{try{const r=await fetch(`${c.endpoint}${path}`,{headers:{apikey:c.anonKey,Authorization:`Bearer ${token}`}});let body=null;try{body=await r.json()}catch{}return{status:r.status,body}}catch{return{status:0,body:null}}};
  const rows=async(role,table,id)=>{const r=await call(`/rest/v1/${table}?select=id${id?`&id=eq.${encodeURIComponent(id)}`:""}`,c.identities[role].token);return{status:r.status,count:Array.isArray(r.body)?r.body.length:-1}};
  const check=(name,pass,status,count)=>results.push({name,pass,status,rowCount:count});
  for(const role of roles){const r=await call("/auth/v1/user",c.identities[role].token);check(`${role}_identity_valid`,r.status===200&&r.body?.id===c.identities[role].userId,r.status,undefined)}
  if(results.some(r=>!r.pass)){emit(false,"identity_validation_failed")}else{
   for(const f of fixtureNames){const r=await rows("superAdmin","people",c.fixtures[f]);check(`${f}_fixture_exists`,r.status===200&&r.count===1,r.status,r.count)}
   if(results.some(r=>!r.pass)){emit(false,"fixture_validation_failed")}else{
    const assertions=[
     ["superAdmin","people",c.fixtures.uehSeasonA,1,"super_admin_ueh"],["superAdmin","people",c.fixtures.hamSeasonA,1,"super_admin_ham"],
     ["uehOperator","people",c.fixtures.uehSeasonA,1,"ueh_in_scope"],["hamOperator","people",c.fixtures.hamSeasonA,1,"ham_in_scope"],
     ["uehOperator","people",c.fixtures.hamSeasonA,0,"ueh_cross_program_denied"],["hamOperator","people",c.fixtures.uehSeasonA,0,"ham_cross_program_denied"],
     ["uehOperator","people",c.fixtures.uehSeasonB,0,"ueh_cross_season_denied"]];
    for(const [role,table,id,count,name] of assertions){const r=await rows(role,table,id);check(name,r.status===200&&r.count===count,r.status,r.count)}
    for(const role of ["reviewer","interviewer"]){const r=await rows(role,"people");check(`${role}_no_broad_people`,r.status===200&&r.count===0,r.status,r.count)}
    for(const role of ["mentor","mentee"]){const r=await rows(role,"admin_users");check(`${role}_denied_admin`,r.status===200&&r.count===0,r.status,r.count)}
    const anon=await call("/rest/v1/admin_users?select=id",c.anonKey);check("anonymous_denied_admin",anon.status===401||anon.status===403||(anon.status===200&&Array.isArray(anon.body)&&anon.body.length===0),anon.status,Array.isArray(anon.body)?anon.body.length:-1);
    for(const table of ["account_import_batches","account_import_outcomes","account_auth_reconciliation","account_import_previews"]){for(const role of roles.filter(r=>r!=="superAdmin")){const x=await rows(role,table);check(`${role}_${table}_denied`,x.status===200&&x.count===0,x.status,x.count)}}
    emit(results.every(r=>r.pass),results.every(r=>r.pass)?"pass":"authorization_boundary_failed");
   }
  }
 }
 }
}
