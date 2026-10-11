import { ClinicalAccess } from "../../components/clinical/ClinicalUI";
import ClinicalWorkspace from "../../components/clinical/ClinicalWorkspace";

export default function DoctorOpdConsole() {
  return <ClinicalAccess hospital><ClinicalWorkspace hospital /></ClinicalAccess>;
}
