export const scopeForPath = path => /\/staff(?:\/|$)|\/api\/(?:staff-messages|forecast|opd-ai|hospitals|inpatient|nursing|emergency|theatre|revenue|procurement|integrations|enterprise|labs\/(?:catalog|orders|capabilities|reviewers)|pharmacy\/(?:inventory|prescriptions))(?:\/|$)/.test(path)
  || (/\/api\/opd\//.test(path) && !/\/(?:book|my-token)$/.test(path)) ? "staff" : "account";
