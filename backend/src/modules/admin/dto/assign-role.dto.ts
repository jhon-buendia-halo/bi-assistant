/** Body of `POST /admin/role-assignments` (api.md 79). */
export class AssignRoleDto {
  userId: string;
  role: string;
  datasourceId?: string;
}
