import { useSearchParams } from "react-router-dom";
import { Building2, Search } from "lucide-react";
import { Banner, Button, Card, EmptyState, Field, LoadingState } from "../components/ui";
import { HospitalCard, PatientPage, ResourceNotice } from "../components/patient/PatientUI";
import { useCareResource } from "../hooks/useCareResource";
import { careSystems } from "../utils/patientCare";
export default function HospitalsListPage() {
  const [params, setParams] = useSearchParams(), page = Math.max(1, Number(params.get("page")) || 1), limit = 12;
  const query = new URLSearchParams({ name: params.get("name") || "", city: params.get("city") || "", medicineSystem: params.get("medicineSystem") || "", page, limit });
  const resource = useCareResource("/api/hospitals?" + query), items = resource.data?.items || [], total = resource.data?.total;
  const pages = Number.isFinite(total) ? Math.max(1, Math.ceil(total / limit)) : page;
  const changePage = value => setParams({ ...Object.fromEntries(params), page: String(value) });
  const submit = event => {
    event.preventDefault(); const form = new FormData(event.currentTarget), next = {};
    for (const key of ["name", "city", "medicineSystem"]) if (String(form.get(key) || "").trim()) next[key] = String(form.get(key)).trim();
    setParams(next); resource.refresh();
  };
  return <PatientPage eyebrow="MediPulse hospital directory" title="Find a Hospital" description="Explore hospital profiles, departments and booking options. Choose the hospital that fits your next step in care." aside={<><Building2 size={30} aria-hidden="true" /><h2>A clear place to start</h2><ol><li>Find a hospital by name, city or care system.</li><li>Explore its departments and doctor profiles.</li><li>Check actual booking options on its website.</li></ol></>}>
    <Card as="form" onSubmit={submit} key={params.toString()} className="mp-hospital-filters" aria-label="Search hospitals"><Field label="Hospital name" name="name" defaultValue={params.get("name") || ""} placeholder="Search by name" /><Field label="City" name="city" defaultValue={params.get("city") || ""} placeholder="Choose a city" /><Field as="select" label="Care system" name="medicineSystem" defaultValue={params.get("medicineSystem") || ""}>{careSystems.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Field><Button type="submit"><Search size={17} aria-hidden="true" />Search hospitals</Button></Card>
    <ResourceNotice resource={resource} label="hospitals" />
    {resource.loading && !resource.data ? <LoadingState>Loading hospital profiles...</LoadingState> : <><div className="mp-patient-section-heading"><div><h2>Hospital profiles</h2><p>{resource.data ? Number.isFinite(total) ? total + (total === 1 ? " hospital found" : " hospitals found") : items.length + " profiles shown" : "Results are unavailable until the search succeeds."}</p></div>{params.size > 0 && <Button variant="ghost" onClick={() => setParams({})}>Clear filters</Button>}</div>{items.length ? <div className="mp-hospital-results">{items.map(hospital => <HospitalCard key={hospital._id} hospital={hospital} />)}</div> : !resource.error ? <Card><EmptyState title="No hospitals match this search" action={<Button variant="secondary" onClick={() => setParams({})}>Reset search</Button>}>Try a different name, city or care system.</EmptyState></Card> : <Banner>Search is unavailable. Retry to check hospital profiles.</Banner>}
    {resource.data && pages > 1 && <nav className="mp-patient-pagination" aria-label="Hospital result pages"><Button variant="secondary" disabled={page <= 1 || resource.loading} onClick={() => changePage(page - 1)}>Previous hospitals</Button><span>Page {page} of {pages}</span><Button variant="secondary" disabled={page >= pages || resource.loading} onClick={() => changePage(page + 1)}>Next hospitals</Button></nav>}</>}
  </PatientPage>;
}
