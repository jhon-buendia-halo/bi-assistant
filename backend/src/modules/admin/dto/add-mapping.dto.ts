/** Body of `POST /admin/role-mappings` (api.md 89). */
export class AddMappingDto {
  groupId: string;
  role: string;
  datasourceId?: string;
}
