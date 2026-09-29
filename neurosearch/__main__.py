import sys

from neurosearch.yandex import analyze_address


def main() -> None:
    address = " ".join(sys.argv[1:]).strip()
    if not address:
        sys.exit("Укажите адрес: python -m neurosearch \"Казань, улица Баумана, 42\"")
    result = analyze_address(address)
    print(result.text)
    if result.sources:
        print("\nИсточники:")
        for index, source in enumerate(result.sources, start=1):
            mark = "использован" if source.used else "не использован"
            print(f"[{index}] {source.title} — {source.url} ({mark})")


if __name__ == "__main__":
    main()
