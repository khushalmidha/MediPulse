export const scopeForPath = path => /\/staff(?:\/|$)|\/api\/(?:staff-messages|forecast|opd-ai|copilot|hospitals|labs\/(?:catalog|orders)|pharmacy\/(?:inventory|prescriptions))(?:\/|$)/.test(path)
  || (/\/api\/opd\//.test(path) && !/\/(?:book|my-token)$/.test(path)) ? "staff" : "account";
