import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { AccountStore } from '../site/data.js';
import { createAccountOverview } from '../site/party-overview.js';
import { candidateNodes, candidateContext, candidateLabel, findCandidates, buildCandidateFlow } from '../site/candidate-overview.js';
import { layoutFlow } from '../site/flow-layout.js';
import { publishStore } from '../scripts/refresh-data.mjs';
import { csv, receipt, contracted, paid } from './fixtures.mjs';
function ingest(store, kind, rows) { const parser=store.reader(kind,`${kind}.csv`);parser.push(csv(rows));parser.finish(); }
function example() {
 const store=new AccountStore('candidates');
 ingest(store,'receipts',[
  receipt({NM_CANDIDATO:'JOÃO TESTE',DS_CARGO:'Deputado Estadual',VR_RECEITA:'999,00',DT_PRESTACAO_CONTAS:'01/09/2026'}),
  receipt({NM_CANDIDATO:'JOÃO TESTE',DS_CARGO:'Deputado Estadual',VR_RECEITA:'100,00',TP_PRESTACAO_CONTAS:'PARCIAL'}),
  receipt({SQ_PRESTADOR_CONTAS:'OUTRA-CONTA',SQ_CANDIDATO:'OUTRA-CANDIDATURA',NM_CANDIDATO:'JOÃO TESTE',DS_CARGO:'Deputado Estadual',SG_UF:'RJ',VR_RECEITA:'50,00'}),
 ]);
 ingest(store,'contracted',[contracted({DS_CARGO:'Deputado Estadual',VR_DESPESA_CONTRATADA:'70,00',TP_PRESTACAO_CONTAS:'parcial'})]);
 ingest(store,'paid',[paid({VR_PAGTO_DESPESA:'30,00',DS_ORIGEM_DESPESA:'Serviço sintético',TP_PRESTACAO_CONTAS:'Parcial'})]);
 return createAccountOverview(store);
}
test('resumo de candidaturas preserva identidade e reúne caixa da mesma prestação sem somar datas',()=>{
 const data=example();assert.equal(data.scope,'candidates');assert.equal(data.accounts.length,2);
 const account=data.accounts.find(a=>a.prestador!=='OUTRA-CONTA');
 assert.equal(account.name,'JOÃO TESTE');assert.equal(account.candidateId,'90000000000000002');assert.equal(account.number,'99999');assert.equal(account.party,'TESTE');assert.equal(account.uf,'SP');
 assert.equal(account.statements[0].totals.receipts.knownCents,10000);assert.equal(account.statements[0].totals.contracted.knownCents,7000);assert.equal(account.statements[0].totals.paid.knownCents,3000);
 assert.equal(account.statements.length,2);assert.equal(data.accounts[0].name,data.accounts[1].name);assert.notEqual(data.accounts[0].id,data.accounts[1].id);
});
test('zoom de cargo e estado conserva todas as contas e diferencia homônimos pelo id',()=>{
 const data=example(),root=candidateNodes(data.accounts,'receipts');assert.equal(root.length,1);assert.equal(root[0].cents,15000);
 const states=candidateNodes(root[0].accounts,'receipts','uf');assert.equal(states.length,2);assert.equal(states.reduce((sum,a)=>sum+a.cents,0),15000);
 const names=candidateNodes(data.accounts,'receipts','names');assert.equal(names.length,2);assert.notEqual(names[0].id,names[1].id);assert.match(names[0].label,/JOÃO TESTE.*TESTE/);
 assert.equal(candidateContext(root[0]).stage,'uf');assert.equal(candidateContext(states[0]).stage,'names');assert.equal(candidateContext(names[0]).stage,'selected');
});
test('grupos alfabéticos incluem valores zero, ausentes e negativos e mantêm os mesmos membros entre métricas',()=>{
 const store=new AccountStore('candidates');
 ingest(store,'receipts',Array.from({length:137},(_,i)=>receipt({SQ_PRESTADOR_CONTAS:String(i),NM_CANDIDATO:`Nome ${i}`,VR_RECEITA:i===0?'0,00':i===1?'#NULO#':i===2?'-10,00':'10,00'})));
 const data=createAccountOverview(store),nodes=candidateNodes(data.accounts,'receipts','names');assert.ok(nodes.length<=12);
 assert.equal(nodes.reduce((sum,a)=>sum+a.accounts.length,0),137);assert.equal(nodes.reduce((sum,a)=>sum+(a.cents??0),0),133000);assert.equal(nodes.reduce((sum,a)=>sum+a.missing,0),1);
 assert.deepEqual(nodes.map(a=>a.id),candidateNodes(data.accounts,'paid','names').map(a=>a.id));
 const leaves=[];const visit=members=>{for(const entry of candidateNodes(members,'receipts','names'))entry.level==='account'?leaves.push(entry):visit(entry.accounts);};visit(data.accounts);
 assert.equal(leaves.length,137);assert.equal(new Set(leaves.map(a=>a.id)).size,137);assert.equal(leaves.find(a=>a.accounts[0].prestador==='2').cents,-1000);assert.equal(leaves.find(a=>a.accounts[0].prestador==='1').cents,0);assert.equal(leaves.find(a=>a.accounts[0].prestador==='1').missing,1);
});
test('busca combina nome sem acentos, número e contexto sem reunir contas homônimas',()=>{
 const data=example();assert.equal(findCandidates(data.accounts,'joao').length,2);assert.equal(findCandidates(data.accounts,'joao SP').length,1);assert.equal(findCandidates(data.accounts,'99999 RJ').length,1);assert.equal(findCandidates(data.accounts,'inexistente').length,0);assert.equal(findCandidates(data.accounts,'').length,0);
});
test('fluxo de candidatos navega cargo, estado e conta mantendo entradas e saídas independentes',()=>{
 const data=example(),graph=buildCandidateFlow(data,{stage:'office'});assert.equal(graph.centerTitle,'Cargos');assert.equal(graph.columns[1].length,1);assert.equal(graph.totals.receipts.cents,15000);assert.equal(graph.totals.outgoing.cents,3000);
 const stateGraph=buildCandidateFlow(data,candidateContext(graph.columns[1][0].navigation));assert.equal(stateGraph.centerTitle,'Estados');assert.equal(stateGraph.columns[1].length,2);
 const nameGraph=buildCandidateFlow(data,candidateContext(stateGraph.columns[1].find(a=>a.navigation.accounts[0].uf==='SP').navigation));assert.equal(nameGraph.centerTitle,'Candidaturas');assert.equal(nameGraph.columns[1].length,1);
 const context=candidateContext(nameGraph.columns[1][0].navigation),selected=buildCandidateFlow(data,{...context,outgoing:'contracted'});assert.equal(selected.totals.receipts.cents,10000);assert.equal(selected.totals.outgoing.cents,7000);
 assert.ok(data.accounts.every(a=>a.party==='TESTE'));assert.match(selected.columns[1][0].label,/JOÃO TESTE/);
 const layout=layoutFlow(selected);assert.ok(layout.links.every(edge=>edge.thickness===edge.cents*layout.scale));assert.ok(layout.nodes.every(a=>a.y+a.height<=layout.height));
});
test('publicação dos candidatos inclui resumo compacto com a mesma data dos arquivos de detalhes',async()=>{
 const target=await mkdtemp(join(tmpdir(),'prestaconta-candidates-overview-'));
 try{const store=new AccountStore('candidates');ingest(store,'receipts',[receipt()]);store.loadedAt='2026-10-07T12:00:00Z';const index=await publishStore(store,target);
  assert.equal(index.overview,'overview.json.gz');const overview=JSON.parse(gunzipSync(await readFile(join(target,index.overview))));assert.equal(overview.scope,'candidates');assert.equal(overview.updatedAt,index.updatedAt);assert.equal(overview.accounts[0].id,index.accounts[0].id);assert.equal(overview.accounts[0].candidateId,index.accounts[0].candidateId);assert.equal(overview.accounts[0].statements[0].totals.receipts.knownCents,123456);
 }finally{await rm(target,{recursive:true,force:true});}
});
