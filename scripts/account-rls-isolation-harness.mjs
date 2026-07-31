import { readFile } from "node:fs/promises";
const roles=["superAdmin","uehOperator","hamOperator","reviewer","interviewer","mentor","mentee"];
const expectedRoles={superAdmin:"super_admin",uehOperator:"core_team",hamOperator:"core_team",reviewer:"reviewer",interviewer:"support_team",mentor:"mentor",mentee:"mentee"};
const results=[];const emit=(pass,reason)=>{process.stdout.write(JSON.stringify({pass,reason,results}));if(!pass)process.exitCode=1};
const ci=process.argv.indexOf("--config");if(ci<0||!process.argv[ci+1])emit(false,"missing_config");else{
 let c;try{c=JSON.parse(await readFile(process.argv[ci+1],"utf8"))}catch{emit(false,"invalid_config")}
 if(c){
  const identities=roles.map(r=>c.identities?.[r]);
  const jwtOk=t=>{try{const p=JSON.parse(Buffer.from(t.split(".")[1],"base64url"));return t.split(".").length===3&&Number.isFinite(p.exp)&&p.exp*1000>Date.now()&&typeof p.sub==="string"}catch{return false}};
  const valid=typeof c.endpoint==="string"&&c.endpoint.length>0&&typeof c.anonKey==="string"&&c.anonKey.length>0&&identities.every(v=>typeof v?.token==="string"&&jwtOk(v.token)&&typeof v?.userId==="string"&&v.userId.length>0)&&new Set(identities.map(v=>v.token)).size===roles.length&&new Set(identities.map(v=>v.userId)).size===roles.length&&c.fixtures?.uehProgramId&&c.fixtures?.hamProgramId&&c.fixtures?.uehSeasonAId&&c.fixtures?.uehSeasonBId&&c.fixtures?.hamSeasonAId&&c.fixtures?.uehSeasonAPersonId&&c.fixtures?.uehSeasonBPersonId&&c.fixtures?.hamSeasonAPersonId;
  if(!valid)emit(false,"missing_duplicate_malformed_or_expired_config");else{
   const call=async(path,token)=>{try{const r=await fetch(`${c.endpoint}${path}`,{headers:{apikey:c.anonKey,Authorization:`Bearer ${token}`}});let body=null;try{body=await r.json()}catch{}return{status:r.status,body}}catch{return{status:0,body:null}}};
   const query=async(role,table,select,filter="")=>{const r=await call(`/rest/v1/${table}?select=${select}${filter}`,c.identities[role].token);return{status:r.status,rows:Array.isArray(r.body)?r.body:null}};
   const check=(name,pass,status,count,kind)=>results.push({name,pass,status,rowCount:count,kind});
   for(const role of roles){const auth=await call("/auth/v1/user",c.identities[role].token);check(`${role}_jwt_subject`,auth.status===200&&auth.body?.id===c.identities[role].userId,auth.status,undefined,"identity");if(role!=="mentor"&&role!=="mentee"){const db=await query(role,"admin_users","auth_user_id,role,status",`&auth_user_id=eq.${encodeURIComponent(c.identities[role].userId)}`);check(`${role}_database_role`,db.status===200&&db.rows?.length===1&&db.rows[0].role===expectedRoles[role]&&db.rows[0].status==="active",db.status,db.rows?.length??-1,"role")}}
   if(results.some(r=>!r.pass))emit(false,"identity_or_role_proof_failed");else{
    for(const [name,id,program] of [["uehSeasonA",c.fixtures.uehSeasonAId,c.fixtures.uehProgramId],["uehSeasonB",c.fixtures.uehSeasonBId,c.fixtures.uehProgramId],["hamSeasonA",c.fixtures.hamSeasonAId,c.fixtures.hamProgramId]]){const q=await query("superAdmin","seasons","id,program_id",`&id=eq.${id}`);check(`${name}_topology`,q.status===200&&q.rows?.length===1&&q.rows[0].program_id===program,q.status,q.rows?.length??-1,"fixture")}
    check("ueh_seasons_distinct",c.fixtures.uehSeasonAId!==c.fixtures.uehSeasonBId,200,undefined,"fixture");
    for(const [name,person,season,program] of [["uehA",c.fixtures.uehSeasonAPersonId,c.fixtures.uehSeasonAId,c.fixtures.uehProgramId],["uehB",c.fixtures.uehSeasonBPersonId,c.fixtures.uehSeasonBId,c.fixtures.uehProgramId],["hamA",c.fixtures.hamSeasonAPersonId,c.fixtures.hamSeasonAId,c.fixtures.hamProgramId]]){const q=await query("superAdmin","person_season_memberships","person_id,season_id,program_id",`&person_id=eq.${person}&season_id=eq.${season}&program_id=eq.${program}`);check(`${name}_membership_topology`,q.status===200&&q.rows?.length===1,q.status,q.rows?.length??-1,"fixture")}
    if(results.some(r=>!r.pass))emit(false,"fixture_topology_failed");else{
     const assertions=[["uehOperator",c.fixtures.uehSeasonAPersonId,1,"ueh_in_scope"],["uehOperator",c.fixtures.uehSeasonBPersonId,0,"ueh_same_program_cross_season_denied"],["uehOperator",c.fixtures.hamSeasonAPersonId,0,"ueh_cross_program_denied"],["hamOperator",c.fixtures.hamSeasonAPersonId,1,"ham_in_scope"]];for(const [role,id,count,name] of assertions){const q=await query(role,"people","id",`&id=eq.${id}`);check(name,q.status===200&&q.rows?.length===count,q.status,q.rows?.length??-1,"rls_filter")}
     for(const table of ["account_import_batches","account_import_outcomes","account_auth_reconciliation","account_import_previews"]){for(const role of roles.filter(r=>r!=="superAdmin")){const q=await query(role,table,"id");const privilegeDenied=q.status===401||q.status===403;const filtered=q.status===200&&q.rows?.length===0;check(`${role}_${table}_denied`,privilegeDenied||filtered,q.status,q.rows?.length??-1,privilegeDenied?"privilege_denial":filtered?"rls_filter":"unexpected")}}
     emit(results.every(r=>r.pass),results.every(r=>r.pass)?"pass":"authorization_boundary_failed");
    }
   }
  }
 }
}