#!/usr/bin/env python3
"""
Accuracy validation script for the OpenRenew extraction service.
Usage: python test_accuracy.py contracts/          # all PDFs in directory
       python test_accuracy.py contracts/aws.pdf   # single file
"""
import sys, os, time, pathlib
import httpx

SERVICE_URL = os.getenv("EXTRACTION_SERVICE_URL", "http://localhost:8000")
FIELDS = ["party_a", "party_b", "effective_date", "expiry_date", "renewal_date",
          "auto_renew", "notice_period_days", "contract_value"]

def run_extraction(pdf_path: pathlib.Path) -> dict:
    with open(pdf_path, "rb") as f:
        r = httpx.post(f"{SERVICE_URL}/extract-file",
                       files={"file": (pdf_path.name, f, "application/pdf")},
                       timeout=120)
    return r.json() if r.status_code == 200 else {"error": r.json().get("error", "unknown")}

def confidence_emoji(c) -> str:
    if isinstance(c, float):
        if c >= 0.90: return f"{c:.2f} 🟢"
        if c >= 0.70: return f"{c:.2f} 🟡"
        return f"{c:.2f} 🔴"
    return str(c)

def fmt_field(val) -> str:
    if val is None: return "✗ null"
    s = str(val)
    return f"✓ {s[:10]}" if len(s) > 10 else f"✓ {s}"

def main():
    if len(sys.argv) < 2:
        print("Usage: python test_accuracy.py <pdf_or_directory> [--delay N]")
        sys.exit(1)

    args = sys.argv[1:]
    delay = 0
    if "--delay" in args:
        i = args.index("--delay")
        delay = float(args[i + 1])
        args = [a for j, a in enumerate(args) if j != i and j != i + 1]

    path = pathlib.Path(args[0])
    pdfs = sorted(path.glob("*.pdf")) if path.is_dir() else [path]
    if not pdfs:
        print(f"No PDFs found in {path}")
        sys.exit(1)

    results = []
    for idx, pdf in enumerate(pdfs):
        if delay and idx > 0:
            print(f"  (waiting {delay}s for rate limit...)")
            time.sleep(delay)
        print(f"Processing {pdf.name}...", end=" ", flush=True)
        t = time.time()
        data = run_extraction(pdf)
        elapsed = int((time.time() - t) * 1000)
        results.append({"file": pdf.name, "data": data, "elapsed_ms": elapsed})
        print("done" if "fields" in data else f"ERROR: {data.get('error')}")

    # Print table
    col_w = 22
    print("\n" + "─" * (col_w + (13 * len(FIELDS)) + 22 + 12))
    header = f"{'file':<{col_w}}" + "".join(f"{f[:11]:<13}" for f in FIELDS) + f"{'confidence':<22}{'time(ms)':<12}"
    print(header)
    print("─" * len(header))

    succeeded, total_confidence, total_fields_extracted, total_fields = 0, 0.0, 0, 0
    errors = []
    total_time = 0

    for r in results:
        data, file, elapsed = r["data"], r["file"], r["elapsed_ms"]
        total_time += elapsed
        if "error" in data and "fields" not in data:
            errors.append(file)
            row = f"{file[:col_w-1]:<{col_w}}" + "".join(f"{'✗ err':<13}" for _ in FIELDS)
            row += f"{data.get('error','error'):<22}{elapsed:<12}"
        else:
            succeeded += 1
            fields = data.get("fields", {})
            conf = fields.get("confidence")
            total_confidence += conf or 0
            extracted = sum(1 for f in FIELDS if fields.get(f) is not None)
            total_fields_extracted += extracted
            total_fields += len(FIELDS)
            row = f"{file[:col_w-1]:<{col_w}}"
            row += "".join(f"{fmt_field(fields.get(f)):<13}" for f in FIELDS)
            row += f"{confidence_emoji(conf):<22}{elapsed:<12}"
        print(row)

    print("─" * len(header))
    n = len(results)
    avg_conf = total_confidence / succeeded if succeeded else 0
    pct = f"{total_fields_extracted}/{total_fields} ({100*total_fields_extracted//total_fields if total_fields else 0}%)"
    avg_time = total_time // n if n else 0
    print(f"\nSummary: {succeeded}/{n} succeeded · avg confidence {avg_conf:.3f} · fields extracted: {pct} · avg time {avg_time:,}ms")
    if errors:
        print(f"Scanned/failed: {len(errors)} ({', '.join(errors)})")

if __name__ == "__main__":
    main()
