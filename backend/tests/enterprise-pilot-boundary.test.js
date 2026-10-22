import test from "node:test";
import assert from "node:assert/strict";
import { assertEnterprisePilot } from "../services/enterprisePilot.js";
import { getWards } from "../services/ipdAdtService.js";
import { getInpatientFlowsheet } from "../services/nursingCareService.js";
import { getTariffs } from "../services/hospitalRevenueStockService.js";
import { getExternalInterfaceContracts } from "../services/hospitalIntegrationsService.js";

test("enterprise runtime requires explicit pilot enablement before database access", async () => {
  const prior = { NODE_ENV: process.env.NODE_ENV, ENTERPRISE_PILOT_ENABLED: process.env.ENTERPRISE_PILOT_ENABLED };
  try {
    delete process.env.ENTERPRISE_PILOT_ENABLED;
    for (const mode of ["production", "development", undefined]) {
      if (mode) process.env.NODE_ENV = mode; else delete process.env.NODE_ENV;
      for (const action of [getWards, getInpatientFlowsheet, getTariffs, getExternalInterfaceContracts]) await assert.rejects(action({}), error => error.status === 503 && /operating approval/.test(error.message));
    }
    process.env.ENTERPRISE_PILOT_ENABLED = "true"; assert.doesNotThrow(assertEnterprisePilot);
    process.env.ENTERPRISE_PILOT_ENABLED = "false"; assert.throws(assertEnterprisePilot, /operating approval/);
  } finally { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
