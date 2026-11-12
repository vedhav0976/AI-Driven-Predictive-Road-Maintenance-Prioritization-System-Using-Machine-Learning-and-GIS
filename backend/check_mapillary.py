"""Check Mapillary credentials and downloads without creating saved analyses."""

import argparse
from pathlib import Path

from dotenv import load_dotenv

from backend import mapillary_client


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    load_dotenv(root / ".env", override=False)
    load_dotenv(root / ".env.local", override=False)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="Also verify the first image download in memory")
    args = parser.parse_args()
    try:
        images = mapillary_client.search_images((77.58, 12.96, 77.61, 12.985), limit=3)
        print(f"Mapillary search succeeded: {len(images)} images returned.")
        if images:
            print(f"First image: {images[0]['id']}")
            if args.download:
                content, mime, _metadata = mapillary_client.download_image(images[0]["id"])
                print(f"Image download succeeded: {len(content)} bytes, {mime}.")
        return 0
    except mapillary_client.MapillaryError as exc:
        print(f"Mapillary check failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
