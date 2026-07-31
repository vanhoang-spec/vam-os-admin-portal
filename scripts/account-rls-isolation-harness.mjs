import { readFile } from "node:fs/promises";

const requiredIdentities = ["superAdmin","uehOperator","hamOperator","reviewer","interviewer","mentor","mentee"];
function safeFail(reason) { process.stdout.write(JSON.stringify({ pass:false, reason, results:[] })); process.exitCode=1; }
const configIndex=process.argv.indexOf("--config");
if(configIndex<0||!process.argv[configIndex+1]) safeFail("missing_config");
else {
  let config;
  try { config=JSON.parse(await readFile(process.argv[configIndex+1],"utf8")); } catch { safeFail("invalid_config"); }
  if(config) {
    const valid=typeof config.endpoint==="string"&&typeof config.anonKey==="string"&&requiredIdentities.every(k=>typeof config.identities?.[k]==="string")&&["uehPersonId","hamPersonId"].every(k=>typeof config.fixtures?.[k]==="string");
    if(!valid) safeFail("missing_required_identity_or_fixture");
    else {
      const results=[];
      async function rows(name,token,table,query="") { try { const response=await fetch(`${config.endpoint}/rest/v1/${table}?select=id${query}`,{headers:{apikey:config.anonKey,Authorization:`Bearer ${token}`}}); const body=response.ok?await response.json():[]; return {name,status:response.status,count:Array.isArray(body)?body.length:0}; } catch { return {name,status:0,count:0,transportFailure:true}; } }
      function assert(name,actual,predicate){const pass=predicate(actual);results.push({name,pass,status:actual.status,rowCount:actual.count});}
      const anon=await rows("anon_admin",config.anonKey,"admin_users"); assert("anonymous_denied_admin",anon,r=>r.status===401||r.status===403||(r.status===200&&r.count===0));
      for(const role of ["mentor","mentee","reviewer","interviewer"]){const r=await rows(`${role}_admin`,config.identities[role],"admin_users");assert(`${role}_denied_admin`,r,x=>x.status===401||x.status===403||(x.status===200&&x.count===0));}
      for(const role of ["reviewer","interviewer"]){const r=await rows(`${role}_people`,config.identities[role],"people");assert(`${role}_no_broad_people`,r,x=>x.status===401||x.status===403||(x.status===200&&x.count===0));}
      const uehOwn=await rows("ueh_own",config.identities.uehOperator,"people",`&id=eq.${encodeURIComponent(config.fixtures.uehPersonId)}`);assert("ueh_operator_own_program",uehOwn,r=>r.status===200&&r.count===1);
      const uehCross=await rows("ueh_cross",config.identities.uehOperator,"people",`&id=eq.${encodeURIComponent(config.fixtures.hamPersonId)}`);assert("ueh_operator_cross_program_denied",uehCross,r=>r.status===200&&r.count===0);
      const hamCross=await rows("ham_cross",config.identities.hamOperator,"people",`&id=eq.${encodeURIComponent(config.fixtures.uehPersonId)}`);assert("ham_operator_cross_program_denied",hamCross,r=>r.status===200&&r.count===0);
      for(const table of ["account_import_batches","account_import_outcomes"]){for(const role of ["mentor","mentee","uehOperator"]){const r=await rows(`${role}_${table}`,config.identities[role],table);assert(`${role}_denied_${table}`,r,x=>x.status===401||x.status===403||(x.status===200&&x.count===0));}}
      const superUeh=await rows("super_ueh",config.identities.superAdmin,"people",`&id=eq.${encodeURIComponent(config.fixtures.uehPersonId)}`);const superHam=await rows("super_ham",config.identities.superAdmin,"people",`&id=eq.${encodeURIComponent(config.fixtures.hamPersonId)}`);assert("super_admin_cross_program",{status:Math.min(superUeh.status,superHam.status),count:superUeh.count+superHam.count},r=>r.status===200&&r.count===2);
      process.stdout.write(JSON.stringify({pass:results.every(r=>r.pass),serviceRoleBypass:"documented_not_tested_as_end_user",results})); if(results.some(r=>!r.pass)) process.exitCode=1;
    }
  }
}
