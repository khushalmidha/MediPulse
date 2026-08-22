import { matchPath } from 'react-router-dom';
console.log(matchPath('/triage/:doctorId', '/triage/123'));
console.log(matchPath('/triage/:appointmentId', '/triage/123'));
