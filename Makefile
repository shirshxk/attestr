.PHONY: setup run stop test benchmark seed logs clean

setup:
	@echo "Building Attestr containers..."
	docker compose build

run:
	docker compose up

run-detached:
	docker compose up -d
	@echo "Backend:  http://localhost:8000"
	@echo "Frontend: http://localhost:5173"
	@echo "Mailhog:  http://localhost:8025"
	@echo "API docs: http://localhost:8000/docs"

stop:
	docker compose down

seed:
	@echo "Seeding demo organizations (Elastic, Airtable, Grammarly, Plaid)..."
	docker exec -it attestr_backend python scripts/seed_demo.py

test:
	docker compose run --rm backend pytest tests/ -v

benchmark:
	@echo "Running cryptographic benchmarks..."
	docker exec -it attestr_backend python performance/benchmark.py

logs:
	docker compose logs -f backend

clean:
	docker compose down -v
	@echo "All containers and volumes removed."
