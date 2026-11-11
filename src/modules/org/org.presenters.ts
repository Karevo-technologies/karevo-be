import { Organisation, OrgMember } from '@prisma/client';
import { MemberView, OrgProfileView } from './dto/org.dto';

export function toOrgProfileView(o: Organisation): OrgProfileView {
  return {
    id: o.id,
    name: o.name,
    kind: o.kind,
    status: o.status,
    cacNumber: o.cacNumber,
    email: o.email,
    phone: o.phone,
    authorisedPerson: o.authorisedPerson,
    createdAt: o.createdAt.toISOString(),
  };
}

export function toMemberView(m: OrgMember): MemberView {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    role: m.role,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
    activatedAt: m.activatedAt ? m.activatedAt.toISOString() : null,
  };
}
