import argparse
import uuid

from dotenv import load_dotenv

from src.graph import create_graph

load_dotenv("config/.env")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", default="Latest AI News")
    parser.add_argument("--trend-mode", action="store_true", help="Enable trend-driven content generation")
    parser.add_argument("--dry-run", action="store_true", help="Compile graph without execution")
    args = parser.parse_args()

    run_id = str(uuid.uuid4())[:8]

    initial = {"run_id": run_id, "bucket": args.query, "limit": 3, "trend_mode": args.trend_mode}

    app = create_graph()
    if args.dry_run:
        print("Graph compiled successfully.")
        return

    result = app.invoke(initial)

    print(f"Workflow Complete. Video: {result.get('video_path')}")


if __name__ == "__main__":
    main()
