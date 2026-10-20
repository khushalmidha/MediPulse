import { test, expect } from "@playwright/test";
const api="http://127.0.0.1:19080", doctor="000000000000000000000001", family="000000000000000000000020";
const headers={"Idempotency-Key":"synthetic-hold-review-key","X-CSRF-Token":"fixture-account-csrf"};
async function setup(request){
 await request.post(api+"/__fixture/reset",{data:{schedule:true}});
 const availability=await(await request.get(api+"/api/scheduling/availability?doctorId="+doctor)).json();
 const session=availability.sessions.find(item=>item.appointmentType==='scheduled_online');
 const held=await request.post(api+"/api/scheduling/holds",{headers,data:{slotId:session.slots[0]._id,familyMemberId:family}});
 expect(held.status()).toBe(201);return (await held.json());
}
test.beforeEach(async({page})=>{
 await page.route('**/*',route=>{const url=new URL(route.request().url());return url.hostname==='127.0.0.1'&&['15173','19080'].includes(url.port)?route.continue():route.abort();});
});
test('deep-linked family reservation review uses its stored patient identity',async({page,request})=>{
 const held=await setup(request);
 await page.goto(`/appointment/book/${doctor}?reservation=${held.reservation._id}`,{waitUntil:'domcontentloaded'});
 const dialog=page.getByRole('dialog',{name:'Review your reservation'});await expect(dialog).toBeVisible();
 await expect(dialog.locator('dd').filter({hasText:'Fixture Child'})).toBeVisible();
 await expect(dialog.locator('dd').filter({hasText:'Myself'})).toHaveCount(0);
});
test('completed scheduled visits leave the upcoming filter and appear in completed',async({page,request})=>{
 const held=await setup(request);
 const confirmed=await request.post(api+`/api/scheduling/reservations/${held.reservation._id}/confirm`,{headers:{...headers,'Idempotency-Key':'synthetic-confirm-review-key'},data:{}});
 expect(confirmed.status()).toBe(200);
 const state=await(await request.get(api+'/__fixture/state')).json();
 const visits=state.scheduleVisits;visits[0].appointment.status='completed';visits[0].appointment.admissionState='arrived';
 await request.post(api+'/__fixture/patch',{data:{scheduleVisits:visits}});
 await page.goto('/my-appointments',{waitUntil:'domcontentloaded'});
 await page.getByLabel('Show visits').selectOption('upcoming');await expect(page.getByText('No visits match this filter.',{exact:true})).toBeVisible();
 await page.getByLabel('Show visits').selectOption('completed');await expect(page.getByRole('link',{name:'Follow this visit',exact:true})).toBeVisible();
});
