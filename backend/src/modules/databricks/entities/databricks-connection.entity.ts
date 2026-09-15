export interface DatabricksConnection {
  kind: 'databricks';
  host: string;
  token: string;
  warehouseId: string;
  createdAt?: string;
  updatedAt?: string;
}
