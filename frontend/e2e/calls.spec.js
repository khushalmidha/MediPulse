import { test, expect } from "@playwright/test";
const api = "http://127.0.0.1:19080", booking = "/appointment/book/000000000000000000000001";
const protect = async context => context.route("**/*", route => {
  const url = new URL(route.request().url());
  return url.hostname === "127.0.0.1" && ["15173", "19080"].includes(url.port) ? route.continue() : route.abort();
});
const remoteLive = async page => {
  // Assert decoded frames in the participant's visible tab, as in real use.
  await page.bringToFront();
  await page.locator("video").first().scrollIntoViewIfNeeded();
  return page.locator("video").first().evaluate(video => Boolean(video.srcObject?.getVideoTracks().some(track => track.readyState === "live") && video.videoWidth > 0));
};
test("both participants exchange real media, recover doctor disconnect, leave/rejoin and end once", async ({ browser, request }, info) => {
  await request.post(`${api}/__fixture/reset`, { data: { callMode: true } });
  const options = { baseURL: "http://127.0.0.1:15173", viewport: info.project.use.viewport, permissions: ["camera", "microphone"] };
  const doctor = await browser.newContext(options), patient = await browser.newContext(options);
  try {
    await protect(doctor); await protect(patient);
    await doctor.addCookies([{ name: "fixtureRole", value: "doctor", url: "http://127.0.0.1:15173", httpOnly: true }]);
    const doc = await doctor.newPage(), user = await patient.newPage();
    await doc.goto("/doctor/appointments", { waitUntil: "domcontentloaded" }); await user.goto("/appointments/current/000000000000000000000003", { waitUntil: "domcontentloaded" });
    await doc.getByRole("button", { name: "Join call", exact: true }).click(); await user.getByRole("button", { name: "Join call", exact: true }).click();
    await expect(doc.getByText("Connected", { exact: true })).toBeVisible(); await expect(user.getByText("Connected", { exact: true })).toBeVisible();
    await expect.poll(() => remoteLive(doc)).toBe(true); await expect.poll(() => remoteLive(user)).toBe(true);
    const connections = (await (await request.get(`${api}/__fixture/state`)).json()).doctorConnections;
    await request.post(`${api}/__fixture/disconnect-doctor`);
    await expect.poll(async () => (await (await request.get(`${api}/__fixture/state`)).json()).doctorConnections).toBeGreaterThan(connections);
    await expect.poll(() => remoteLive(doc)).toBe(true); await expect.poll(() => remoteLive(user)).toBe(true);
    expect((await (await request.get(`${api}/__fixture/state`)).json()).callEnded).toBeFalsy();
    await user.locator("video").nth(1).evaluate(video => { window.fixtureLocalTracks = video.srcObject.getTracks(); });
    if (info.project.name === "mobile") {
      for (const page of [doc, user]) {
        await page.setViewportSize({ width: 360, height: 800 });
        const mute = page.getByTitle("Mute", { exact: true }); await mute.scrollIntoViewIfNeeded();
        await expect(mute).toBeInViewport({ ratio: 1 }); await expect(page.getByTitle("Turn off camera", { exact: true })).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      }
    }
    const leave = user.getByRole("button", { name: "Leave call", exact: true }); await leave.focus(); await user.keyboard.press("Enter");
    expect(await user.evaluate(() => window.fixtureLocalTracks.every(track => track.readyState === "ended"))).toBe(true);
    const rejoin = user.getByRole("button", { name: "Rejoin call" }); await expect(rejoin).toBeVisible(); await rejoin.focus(); await user.keyboard.press("Enter");
    await expect(user.getByText("Connected", { exact: true })).toBeVisible(); await expect.poll(() => remoteLive(user)).toBe(true);
    await doc.getByLabel("Doctor notes", { exact: true }).fill("Synthetic reviewed notes retained when ending from video.");
    const end = doc.getByRole("button", { name: "End consultation", exact: true }); await end.focus(); await doc.keyboard.press("Enter");
    await expect(doc.getByRole("dialog", { name: "Complete this consultation?" })).toBeVisible();
    expect((await (await request.get(`${api}/__fixture/state`)).json()).ends || 0).toBe(0);
    await doc.getByRole("button", { name: "Confirm completion", exact: true }).click();
    await expect(doc.locator("video")).toHaveCount(0); await expect(user.locator("video")).toHaveCount(0);
    const final = await (await request.get(`${api}/__fixture/state`)).json();
    expect(final.ends).toBe(1); expect(final.notesAtEnd).toBe("Synthetic reviewed notes retained when ending from video.");
    expect(await user.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  } finally { await doctor.close(); await patient.close(); }
});
test("denied devices show a truthful permission error and keyboard retry", async ({ browser, request }, info) => {
  await request.post(`${api}/__fixture/reset`, { data: { callMode: true } });
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:15173", viewport: info.project.use.viewport });
  try {
    await protect(context);
    await context.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Denied", "NotAllowedError"); }; });
    const page = await context.newPage(); await page.goto(booking, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Join call", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Microphone access is required");
    const retry = page.getByRole("button", { name: "Retry call" }); await retry.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText("Microphone access is required");
    expect((await (await request.get(`${api}/__fixture/state`)).json()).callEnded).toBeFalsy();
  } finally { await context.close(); }
});

test("camera denial falls back to real microphone audio without a fabricated video stream", async ({ browser, request }, info) => {
  await request.post(`${api}/__fixture/reset`, { data: { callMode: true } });
  const options = { baseURL: "http://127.0.0.1:15173", viewport: info.project.use.viewport, permissions: ["camera", "microphone"] };
  const doctor = await browser.newContext(options), patient = await browser.newContext(options);
  try {
    await protect(doctor); await protect(patient);
    await doctor.addCookies([{ name: "fixtureRole", value: "doctor", url: "http://127.0.0.1:15173", httpOnly: true }]);
    await patient.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = constraints => constraints.video ? Promise.reject(new DOMException("Camera denied", "NotAllowedError")) : original(constraints);
    });
    const doc = await doctor.newPage(), user = await patient.newPage();
    await doc.goto("/doctor/appointments", { waitUntil: "domcontentloaded" }); await user.goto(booking, { waitUntil: "domcontentloaded" });
    await doc.getByRole("button", { name: "Join call", exact: true }).click(); await user.getByRole("button", { name: "Join call", exact: true }).click();
    await expect(user.getByText("Camera unavailable. Connected with audio only.")).toBeVisible();
    await expect(doc.getByText("Connected", { exact: true })).toBeVisible(); await expect(user.getByText("Connected", { exact: true })).toBeVisible();
    expect(await user.locator("video").nth(1).evaluate(video => video.srcObject.getVideoTracks().length)).toBe(0);
    expect(await doc.locator("video").first().evaluate(video => video.srcObject.getAudioTracks().length)).toBeGreaterThan(0);
    await doc.getByRole("button", { name: "End consultation", exact: true }).click();
    await doc.getByRole("button", { name: "Confirm completion", exact: true }).click();
    await expect(user.locator("video")).toHaveCount(0);
  } finally { await doctor.close(); await patient.close(); }
});

async function connectedPair(browser, request, info, fixture = {}, initPatient) {
  await request.post(`${api}/__fixture/reset`, { data: { callMode: true, ...fixture } });
  const options = { baseURL: "http://127.0.0.1:15173", viewport: info.project.use.viewport, permissions: ["camera", "microphone"] };
  const doctor = await browser.newContext(options), patient = await browser.newContext(options);
  await protect(doctor); await protect(patient);
  await doctor.addCookies([{ name: "fixtureRole", value: "doctor", url: "http://127.0.0.1:15173", httpOnly: true }]);
  if (initPatient) await patient.addInitScript(initPatient);
  const doc = await doctor.newPage(), user = await patient.newPage();
  try {
    await doc.goto("/doctor/appointments", { waitUntil: "domcontentloaded" }); await user.goto(booking, { waitUntil: "domcontentloaded" });
    await doc.getByRole("button", { name: "Join call", exact: true }).click(); await user.getByRole("button", { name: "Join call", exact: true }).click();
    await expect(doc.getByText("Connected", { exact: true })).toBeVisible(); await expect(user.getByText("Connected", { exact: true })).toBeVisible();
    return { doctor, patient, doc, user, close: async () => { await doctor.close(); await patient.close(); } };
  } catch (error) { await doctor.close(); await patient.close(); throw error; }
}

test("expanded call keeps real media and keyboard chat usable on a narrow screen", async ({ browser, request }, info) => {
  const pair = await connectedPair(browser, request, info);
  try {
    const {user,doc}=pair; await user.setViewportSize({ width: 360, height: 800 });
    await user.getByRole("button", { name: "Expand call", exact: true }).click();
    const room=user.getByRole("dialog", {name:"Online consultation"}); await expect(room).toBeVisible();
    await expect.poll(()=>remoteLive(user)).toBe(true);
    await room.getByRole("button",{name:"Toggle Chat",exact:true}).click();
    await user.getByLabel("Message",{exact:true}).fill("Synthetic call message"); await user.getByRole("button",{name:"Send message",exact:true}).click();
    await doc.getByRole("button",{name:"Toggle Chat",exact:true}).click(); await expect(doc.getByText("Synthetic call message",{exact:true})).toBeVisible();
    await user.getByRole("button",{name:"Close side panel",exact:true}).click();
    await expect(user.getByRole("button",{name:"Mute",exact:true})).toBeInViewport({ratio:1});
    expect(await user.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    for (const theme of ["light", "dark"]) {
      await user.evaluate(value => document.documentElement.classList.toggle("dark", value === "dark"), theme);
      for (const width of [360, 768, 1440]) {
        await user.setViewportSize({width,height:800});
        const box=await room.boundingBox();expect(Math.abs(box.width-width)).toBeLessThan(2);expect(box.height).toBeLessThanOrEqual(801);
        await expect(user.getByRole("button",{name:"Mute",exact:true})).toBeInViewport({ratio:1});
        expect(await user.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
        await user.screenshot({path:info.outputPath(`expanded-call-${theme}-${width}.png`)});
      }
    }
    await user.keyboard.press("Escape"); await expect(room).toHaveCount(0);
    expect(await user.evaluate(()=>document.body.style.overflow)).not.toBe("hidden");
    await expect(user.getByRole("button",{name:"Expand call",exact:true})).toBeFocused();
    await expect.poll(()=>remoteLive(user)).toBe(true);
  } finally { await pair.close(); }
});

test("native fullscreen or its supported fallback exits without ending media", async ({ browser, request }, info) => {
  const pair=await connectedPair(browser,request,info);
  try {
    await pair.user.getByRole("button",{name:"Enter fullscreen",exact:true}).click();
    await expect.poll(()=>pair.user.evaluate(()=>Boolean(document.fullscreenElement||document.querySelector('.mp-call--expanded')))).toBe(true);
    await expect.poll(()=>remoteLive(pair.user)).toBe(true);
    if(await pair.user.evaluate(()=>Boolean(document.fullscreenElement))) await pair.user.getByRole("button",{name:"Exit fullscreen",exact:true}).click();
    else await pair.user.getByRole("button",{name:"Minimize call",exact:true}).click();
    await expect.poll(()=>pair.user.evaluate(()=>Boolean(document.fullscreenElement||document.querySelector('.mp-call--expanded')))).toBe(false);
    await expect.poll(()=>remoteLive(pair.user)).toBe(true);
  } finally {await pair.close();}
});

test("a browser fullscreen rejection opens the accessible expanded fallback", async ({browser,request},info)=>{
  const pair=await connectedPair(browser,request,info,{},()=>{Element.prototype.requestFullscreen=()=>Promise.reject(new DOMException("Blocked","NotAllowedError"));});
  try{
    await pair.user.getByRole("button",{name:"Enter fullscreen",exact:true}).click();
    await expect(pair.user.getByRole("dialog",{name:"Online consultation"})).toBeVisible();
    await pair.user.keyboard.press("Escape");await expect(pair.user.getByRole("dialog",{name:"Online consultation"})).toHaveCount(0);
    await expect.poll(()=>remoteLive(pair.user)).toBe(true);
  }finally{await pair.close();}
});

test("reconnect preserves a muted microphone and disabled camera on fresh tracks", async ({browser,request},info)=>{
  const pair=await connectedPair(browser,request,info);
  try{
    await pair.user.getByRole("button",{name:"Mute",exact:true}).click();await pair.user.getByRole("button",{name:"Turn off camera",exact:true}).click();
    await pair.user.getByRole("button",{name:"Visit information",exact:true}).click();await pair.user.getByRole("button",{name:"Reconnect call",exact:true}).click();
    await expect(pair.user.getByText("Connected",{exact:true})).toBeVisible();
    await expect(pair.user.getByRole("button",{name:"Unmute",exact:true})).toBeEnabled();await expect(pair.user.getByRole("button",{name:"Turn on camera",exact:true})).toBeEnabled();
    expect(await pair.user.locator('video').nth(1).evaluate(v=>v.srcObject.getAudioTracks().every(t=>!t.enabled))).toBe(true);
    expect(await pair.user.locator('video').nth(1).evaluate(v=>v.srcObject.getVideoTracks().every(t=>!t.enabled))).toBe(true);
    await expect(pair.doc.getByText("Camera is off · Audio call",{exact:true})).toBeVisible();
  }finally{await pair.close();}
});

test("audio-only camera recovery acquires a real camera track on user action",async({browser,request},info)=>{
 const pair=await connectedPair(browser,request,info,{},()=>{
  const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);let first=true;
  navigator.mediaDevices.getUserMedia=constraints=>{if(constraints.video&&first){first=false;return Promise.reject(new DOMException("Camera denied","NotAllowedError"));}return original(constraints);};
 });
 try{
  await expect(pair.user.getByRole("button",{name:"Turn on camera",exact:true})).toBeEnabled();
  await pair.user.getByRole("button",{name:"Turn on camera",exact:true}).click();
  await expect(pair.user.getByRole("button",{name:"Turn off camera",exact:true})).toBeEnabled();
  await expect.poll(()=>pair.user.locator('video').nth(1).evaluate(v=>v.srcObject.getVideoTracks().some(t=>t.readyState==='live'&&t.enabled))).toBe(true);
 }finally{await pair.close();}
});

test("an unanswered offer recovers through a bounded peer reset",async({browser,request},info)=>{
 const pair=await connectedPair(browser,request,info,{dropFirstOffer:true});
 try{expect((await(await request.get(`${api}/__fixture/state`)).json()).droppedOffers).toBe(1);await expect.poll(()=>remoteLive(pair.doc)).toBe(true);await expect.poll(()=>remoteLive(pair.user)).toBe(true);}finally{await pair.close();}
});

test("visit information cannot crash a call and navigation releases all device tracks",async({browser,request},info)=>{
 const pair=await connectedPair(browser,request,info);
 try{
  let historyRequests=0;pair.user.on('request',r=>{if(new URL(r.url()).pathname.endsWith('/appointment/history'))historyRequests++;});
  await pair.user.getByRole('button',{name:'Visit information',exact:true}).click();await expect(pair.user.getByText('Automatic speech capture is off.',{exact:false})).toBeVisible();
  expect(historyRequests).toBe(0);await expect.poll(()=>remoteLive(pair.user)).toBe(true);
  await pair.user.locator('video').nth(1).evaluate(v=>{window.callTracks=v.srcObject.getTracks();});
  if (info.project.name === "mobile") await pair.user.getByRole("button", { name: "Toggle mobile menu", exact: true }).click();
  await pair.user.getByRole('link',{name:'My Appointments',exact:true}).click();
  await expect.poll(()=>pair.user.evaluate(()=>window.callTracks.every(t=>t.readyState==='ended'))).toBe(true);
 }finally{await pair.close();}
});


test("camera and microphone require Join call; automatic speech capture never starts",async({browser,request},info)=>{
 await request.post(`${api}/__fixture/reset`,{data:{callMode:true}});
 const context=await browser.newContext({baseURL:"http://127.0.0.1:15173",viewport:info.project.use.viewport,permissions:["camera","microphone"]});
 try{
  await protect(context);await context.addInitScript(()=>{
   const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.mediaAcquisitions=0;window.speechStarts=0;
   navigator.mediaDevices.getUserMedia=constraints=>{window.mediaAcquisitions++;return original(constraints);};
   window.SpeechRecognition=class{start(){window.speechStarts++;}};
  });
  const page=await context.newPage();await page.goto(booking,{waitUntil:"domcontentloaded"});
  await expect(page.getByRole("button",{name:"Join call",exact:true})).toBeVisible();expect(await page.evaluate(()=>window.mediaAcquisitions)).toBe(0);
  await page.getByRole("button",{name:"Join call",exact:true}).click();await expect(page.getByRole("button",{name:"Mute",exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>window.mediaAcquisitions)).toBeGreaterThan(0);expect(await page.evaluate(()=>window.speechStarts)).toBe(0);
 }finally{await context.close();}
});

test("permission loss releases media and does not offer an unauthorized rejoin",async({browser,request},info)=>{
 const pair=await connectedPair(browser,request,info);
 try{
  await pair.user.locator("video").nth(1).evaluate(v=>{window.revokedTracks=v.srcObject.getTracks();});
  await pair.user.route("**/appointment/000000000000000000000003",route=>route.fulfill({status:403,json:{message:"Synthetic access revoked"}}));
  await pair.user.evaluate(()=>window.dispatchEvent(new Event("online")));
  await expect(pair.user.getByText("Call access is unavailable. Refresh the visit or sign in again.",{exact:true})).toBeVisible();
  expect(await pair.user.evaluate(()=>window.revokedTracks.every(t=>t.readyState==='ended'))).toBe(true);
  await expect(pair.user.getByRole("button",{name:"Rejoin call",exact:true})).toHaveCount(0);
 }finally{await pair.close();}
});
