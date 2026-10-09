// Current summary DTOs return counts; retain support for older cached responses.
export const communityMemberCount = community => community.memberCount ?? community.members?.length ?? 0;
