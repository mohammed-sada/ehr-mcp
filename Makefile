.PHONY: up down logs psql reset

up:
\tdocker compose up -d

down:
\tdocker compose down

logs:
\tdocker compose logs -f postgres

psql:
\tdocker compose exec -it postgres psql -U $${POSTGRES_USER:-postgres} -d $${POSTGRES_DB:-mimiciv}

reset:
\t# WARNING: deletes the postgres data volume (full re-init + re-load)
\tdocker compose down -v
\tdocker compose up -d

