import pg from 'pg';
import { readFileSync } from 'fs';
const env = readFileSync('/Users/mac/Desktop/ODIENGROUP/wms-app/.env.local','utf8');
for (const line of env.split('\n')){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m)process.env[m[1]]=m[2];}
const { Pool } = pg;
const pool = new Pool({host:process.env.DATABASE_HOST,port:Number(process.env.DATABASE_PORT),database:process.env.DATABASE_NAME,user:process.env.DATABASE_USER,password:process.env.DATABASE_PASSWORD,ssl:(process.env.DATABASE_SSL??'false').toLowerCase()==='true'?{rejectUnauthorized:false}:undefined});
for (const wh of ['1201','1202']) {
  const f = await pool.query(`SELECT floor, count(*) FROM public.odg_wms_location1 WHERE wh_code=$1 GROUP BY floor ORDER BY floor`,[wh]);
  console.log(`wh ${wh} floor distribution:`, f.rows);
  const lc = await pool.query(`SELECT location_id, count(*) n FROM public.odg_wms_location1 WHERE wh_code=$1 GROUP BY location_id ORDER BY location_id`,[wh]);
  console.log(`wh ${wh} locations per rack:`, lc.rows.map(r=>`${r.location_id}:${r.n}`).join('  '));
}
// stock presence in 1202
const s = await pool.query(`SELECT COALESCE(NULLIF(TRIM(shelf_code),''),'?') rack, count(*) FILTER (WHERE true) lines, count(DISTINCT shelf_code1) locs FROM public.odg_wms_trans_detail WHERE wh_code='1202' GROUP BY rack ORDER BY rack`);
console.log('1202 stock by rack:', s.rows);
await pool.end();
