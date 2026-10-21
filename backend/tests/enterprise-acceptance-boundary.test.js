import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {ExternalInterfaceContract,DisasterRecoveryAudit,EnterpriseSsoProfile} from "../model/hospitalIntegrations.js";
import {generateEnterpriseAcceptanceReport,executeDisasterRecoveryDrill,setIntegrationsTestDouble} from "../services/hospitalIntegrationsService.js";
import {setIpdAdtTestDouble} from "../services/ipdAdtService.js";
import {setNursingTestDouble} from "../services/nursingCareService.js";
import {setEmergencyTheatreTestDouble} from "../services/emergencyTheatreService.js";
import {setRevenueStockTestDouble} from "../services/hospitalRevenueStockService.js";

test("actual enterprise report never treats configured records as operating acceptance",async t=>{
 const prior=mongoose.connection.readyState;mongoose.connection.readyState=1;
 const query=value=>({sort(){return this;},limit(){return this;},lean:async()=>value});
 t.mock.method(ExternalInterfaceContract,"find",()=>query([{status:"configured"}]));
 t.mock.method(DisasterRecoveryAudit,"find",()=>query([{status:"passed"}]));
 t.mock.method(EnterpriseSsoProfile,"findOne",()=>query({isActive:true}));
 try {const report=await generateEnterpriseAcceptanceReport({hospitalId:new mongoose.Types.ObjectId()});for(const milestone of Object.values(report.milestones))assert.equal(milestone.verified,false);assert.equal(report.operatingAcceptance.status,"not_accepted");}finally{mongoose.connection.readyState=prior;}
});

test("drill recording refuses coercion and cannot certify caller-reported integrity",async t=>{
 const prior=mongoose.connection.readyState;mongoose.connection.readyState=1;
 const create=t.mock.method(DisasterRecoveryAudit,"create",async data=>data);
 const input={hospitalId:new mongoose.Types.ObjectId(),drillType:"cold_standby_restore",measuredRpoMinutes:1,measuredRtoMinutes:2,recordsIntegrityVerified:true,conductedBy:"Synthetic operator"};
 try {
  for(const extra of [{measuredRpoMinutes:Infinity},{measuredRtoMinutes:"2"},{recordsIntegrityVerified:"false"}])await assert.rejects(executeDisasterRecoveryDrill({...input,...extra}),error=>error.status===400);
  const result=await executeDisasterRecoveryDrill(input);assert.equal(result.audit.status,"recorded_unverified");assert.equal(result.audit.recordsIntegrityVerified,false);assert.equal(result.audit.reportedIntegrityVerified,true);assert.equal(result.metrics.rpoTargetMet,false);assert.equal(create.mock.callCount(),1);await new DisasterRecoveryAudit(result.audit).validate();
 }finally{mongoose.connection.readyState=prior;}
});

test("enterprise adapters cannot replace runtime behavior outside tests",()=>{
 const prior=process.env.NODE_ENV;process.env.NODE_ENV="production";
 try{for(const setter of [setIpdAdtTestDouble,setNursingTestDouble,setEmergencyTheatreTestDouble,setRevenueStockTestDouble,setIntegrationsTestDouble])assert.throws(()=>setter({}),/only available in tests/);}finally{if(prior===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prior;}
});


test("actual tenant configuration export makes no regulatory certification claim",async t=>{
 const {default:Hospital}=await import("../model/hospital.js");
 const {default:Department}=await import("../model/department.js");
 const {default:HospitalStaff}=await import("../model/hospitalStaff.js");
 const {exportTenantConfiguration}=await import("../services/saasOperationsService.js");
 const prior=mongoose.connection.readyState;mongoose.connection.readyState=1;
 const query=value=>({select(){return this;},lean:async()=>value});
 t.mock.method(Hospital,"findById",()=>query({name:"Synthetic hospital"}));
 t.mock.method(Department,"find",()=>query([]));t.mock.method(HospitalStaff,"find",()=>query([]));
 try{const result=await exportTenantConfiguration({hospitalId:new mongoose.Types.ObjectId()});assert.equal(result.retentionPolicy,"not_configured");assert.equal(result.exportScope,"tenant_configuration_only");assert.equal(result.regulatoryReview,"not_verified");}finally{mongoose.connection.readyState=prior;}
});
