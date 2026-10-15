import { test,expect } from "@playwright/test";
const api="http://127.0.0.1:19080",path="/hospital/laboratory";
const patch=(request,data)=>request.post(api+"/__fixture/patch",{data});
const state=async request=>(await(await request.get(api+"/__fixture/state")).json());
test.beforeEach(async({page,request})=>{
  await request.post(api+"/__fixture/reset",{data:{laboratory:true,nurse:true,staffRole:"LAB_TECH"}});
  await page.route("**/*",route=>{const url=new URL(route.request().url());return url.hostname === "127.0.0.1" && ["15173","19080"].includes(url.port)?route.continue():route.abort();});
});
const enter=async(page,value="6")=>{await page.getByRole("button",{name:"Enter results",exact:true}).click();await page.getByRole("spinbutton",{name:"SYN — Synthetic parameter",exact:true}).fill(value);await page.getByRole("button",{name:"Confirm command",exact:true}).click();};
test("patient access is denied before any laboratory reads",async({page,request})=>{
  await patch(request,{nurse:false});await page.goto(path);await expect(page.getByRole("heading",{name:"Hospital laboratory access is needed"})).toBeVisible();expect((await state(request)).labReads || 0).toBe(0);
});
test("entry uses ordered parameters, server flags, real staff CSRF and closes after success",async({page,request})=>{
  await page.goto(path);await enter(page);await expect(page.getByRole("dialog")).not.toBeVisible();await expect(page.getByText("Report v1 · Draft",{exact:true})).toBeVisible();
  await expect(page.getByText("critical high",{exact:true})).toBeVisible();await expect(page.getByText(/Ordered by Dr\. Synthetic Clinician/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Verify findings",exact:true})).toHaveCount(0);
  expect((await state(request)).labRequests[0].body.results).toEqual([{testCode:"SYN",parameterCode:"P",value:6}]);
});
test("lost response reload retries the identical original command without duplicating the report",async({page,request})=>{
  await patch(request,{labLoseResponse:true});await page.goto(path);await enter(page);await expect(page.getByText(/The response was not confirmed/)).toBeVisible();
  await page.keyboard.press("Escape");await page.reload();await page.getByRole("button",{name:"Resume command",exact:true}).click();await page.getByRole("button",{name:"Retry saved command",exact:true}).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();const result=await state(request);expect(result.labRequests).toHaveLength(2);expect(result.labRequests[0]).toEqual(result.labRequests[1]);expect(result.labRecord.reportVersions).toHaveLength(1);
});
test("independent review, release and correction retain both report versions with draft status",async({page,request})=>{
  await patch(request,{labApproved:true});await page.goto(path);await enter(page);
  for(const label of ["Verify findings","Release report"]) {await page.getByRole("button",{name:label,exact:true}).click();await expect(page.getByRole("dialog").getByText("6 configured-unit",{exact:true})).toBeVisible();await page.getByRole("button",{name:"Confirm command",exact:true}).click();await expect(page.getByRole("dialog")).not.toBeVisible();}
  await page.getByRole("button",{name:"Draft correction",exact:true}).click();await page.getByRole("textbox",{name:"Reason",exact:true}).fill("Synthetic re-run");await page.getByRole("spinbutton",{name:"SYN — Synthetic parameter",exact:true}).fill("3");await page.getByRole("button",{name:"Confirm command",exact:true}).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();await expect(page.getByText("Report v1 · Released",{exact:true})).toBeVisible();await expect(page.getByText("Report v2 · Draft",{exact:true})).toBeVisible();
});
test("administrator records scoped reviewer approval without loading clinical orders",async({page,request})=>{
  await patch(request,{staffRole:"HOSPITAL_ADMIN"});await page.goto(path);await page.getByLabel("Reviewer",{exact:true}).selectOption("000000000000000000000072");await page.getByLabel("Review department",{exact:true}).selectOption("000000000000000000000006");
  await page.getByLabel("Qualification review reference",{exact:true}).fill("Synthetic reviewed credential");await page.getByRole("button",{name:"Record reviewed approval",exact:true}).click();await expect(page.getByText("Reviewer approval recorded.",{exact:true})).toBeVisible();
  const result=await state(request);expect(result.labApproval.enabled).toBe(true);expect(result.labOrderReads || 0).toBe(0);
});
test("assigned clinician acknowledges the exact critical report version",async({page,request})=>{
  await patch(request,{labApproved:true});await page.goto(path);await enter(page);
  await page.getByRole("button",{name:"Verify findings",exact:true}).click();await page.getByRole("button",{name:"Confirm command",exact:true}).click();await expect(page.getByRole("dialog")).not.toBeVisible();
  await patch(request,{staffRole:"DOCTOR"});await page.reload();await page.getByRole("button",{name:"Acknowledge critical result v1",exact:true}).click();
  await page.getByRole("button",{name:"Confirm command",exact:true}).click();await expect(page.getByRole("dialog")).not.toBeVisible();await expect(page.getByText("Assigned clinician acknowledged this version.",{exact:true})).toBeVisible();
  expect((await state(request)).labRequests.at(-1).body.reportVersion).toBe(1);
});
test("administrative portal access enables approvals without granting laboratory report access",async({page,request})=>{
  await patch(request,{staffRole:"PHARMACIST",staffAdminAccess:true});await page.goto(path);
  await expect(page.getByRole("heading",{name:"Reviewer approvals",exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Synthetic Laboratory Patient",exact:true})).toHaveCount(0);expect((await state(request)).labOrderReads || 0).toBe(0);
});
test("stale commands clear the rejected packet and permission loss hides clinical worklist",async({page,request})=>{
  await patch(request,{labStale:true});await page.goto(path);await enter(page);await expect(page.getByText("Laboratory order changed; refresh before retrying",{exact:true})).toBeVisible();await page.keyboard.press("Escape");
  expect((await state(request)).labRecord.reportVersions).toHaveLength(0);
  await patch(request,{labReadStatus:403});await page.getByRole("button",{name:"Refresh",exact:true}).click();await expect(page.getByRole("heading",{name:"Synthetic Laboratory Patient"})).toHaveCount(0);
});
test("pending storage failure prevents a laboratory mutation",async({page,request})=>{
  await page.addInitScript(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith("medipulse.lab.pending"))throw new Error("Synthetic unavailable storage");return original.call(this,key,value);};});
  await page.goto(path);await enter(page);await expect(page.getByText("Session storage is unavailable. This command was not sent.",{exact:true})).toBeVisible();expect((await state(request)).labRequests || []).toHaveLength(0);
});
for(const theme of ["light","dark"])test(`laboratory layout and keyboard dialogs fit all viewports in ${theme}`,async({page},testInfo)=>{
  await page.addInitScript(value=>localStorage.setItem("theme",value),theme);
  for(const width of [360,768,1440]) {await page.setViewportSize({width,height:900});await page.goto(path);await expect(page.getByRole("heading",{name:"Laboratory worklist"})).toBeVisible();
    const bounds=await page.getByRole("heading",{name:"Synthetic Laboratory Patient",exact:true}).boundingBox();expect(bounds.width).toBeGreaterThan(140);expect(bounds.height).toBeLessThan(85);
    const contrast=await page.locator(".mp-lab-accession").evaluate(element=>{
      const luminance=color=>{const channels=color.match(/[\d.]+/g).slice(0,3).map(Number).map(value=>{const c=value/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;});return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;};
      const foreground=luminance(getComputedStyle(element).color),background=luminance(getComputedStyle(element.closest(".mp-card")).backgroundColor);
      return (Math.max(foreground,background)+0.05)/(Math.min(foreground,background)+0.05);
    });expect(contrast).toBeGreaterThanOrEqual(4.5);
    await page.getByRole("button",{name:"Enter results",exact:true}).click();
    const dialogBounds=await page.getByRole("dialog").boundingBox();expect(dialogBounds.width).toBeLessThanOrEqual(width);expect(dialogBounds.height).toBeLessThanOrEqual(900);
    if(width===360 && theme === "dark")await page.screenshot({path:testInfo.outputPath("laboratory-dark-360-dialog.png"),fullPage:true});
    await page.keyboard.press("Escape");await expect(page.getByRole("button",{name:"Enter results",exact:true})).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.classList.contains("dark"))).toBe(theme === "dark");
    if(width===360 && theme === "dark" || width===1440 && theme === "light")await page.screenshot({path:testInfo.outputPath(`laboratory-${theme}-${width}.png`),fullPage:true});
  }
});
