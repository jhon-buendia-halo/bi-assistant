# World Cup sample datasource

This development database contains a medium-complexity relational model for
FIFA World Cup analytics. It includes the quarter-finals through the final for
the 2018 and 2022 tournaments, their teams, venues, players, goals,
disciplinary events, and illustrative team-level match metrics.

The scores and knockout outcomes mirror the real tournaments. Detailed metrics
such as expected goals and passing totals are representative sample values and
must not be treated as an authoritative historical dataset.

## Start it

From the repository root:

```bash
docker compose up -d postgres
docker compose ps
```

Configure the app's PostgreSQL datasource with:

| Field | Value |
| --- | --- |
| Name | World Cup sample |
| Host | `localhost` |
| Port | `55432` |
| Database | `world_cup` |
| User | `world_cup` |
| Password | `world_cup_dev` |
| SSL | Off |

The tables and analytics views are under the `world_cup` schema.

Connect with `psql`:

```bash
docker compose exec postgres psql -U world_cup -d world_cup
```

To re-run the initialization scripts from scratch, remove the development
volume and start the service again:

```bash
docker compose down -v
docker compose up -d postgres
```

Set `WORLD_CUP_DB_PORT` before starting Compose if port 55432 is already in use.
