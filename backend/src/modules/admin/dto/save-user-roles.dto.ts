/**
 * Body of `PUT /admin/users/:id/roles` (api.md 85): the complete set of
 * direct assignments the user should hold. Validated by the service.
 */
export class SaveUserRolesDto {
  roles: { role: string; datasourceId?: string }[];
}
