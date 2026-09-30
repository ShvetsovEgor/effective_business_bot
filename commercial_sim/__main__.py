from pathlib import Path

from commercial_sim.kazan import summary, write_outputs


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    records = write_outputs(root / "data" / "simulated")
    print(summary(records))


if __name__ == "__main__":
    main()
