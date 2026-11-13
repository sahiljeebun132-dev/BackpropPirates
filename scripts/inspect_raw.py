"""Print the shape and a sample of every downloaded parquet so we can see what is usable."""
import sys, glob, os
import pandas as pd
pd.set_option("display.width", 200); pd.set_option("display.max_colwidth", 60)
for p in sorted(glob.glob("data/raw/hf/*/data.parquet")):
    name = os.path.basename(os.path.dirname(p))
    df = pd.read_parquet(p)
    print("=" * 100); print(name, "| rows:", len(df), "| cols:", list(df.columns))
    if "indicator_name" in df:
        print("  indicators:", sorted(df["indicator_name"].astype(str).unique())[:8])
    if "dimension_name" in df:
        u = df["dimension_name"].astype(str).unique()
        print(f"  dimension_name ({len(u)}):", sorted(u)[:14])
    if "dimension_details" in df:
        print("  details sample:", df["dimension_details"].astype(str).head(3).tolist())
    if "year" in df:
        print("  years:", sorted(df["year"].dropna().unique().tolist())[:30])
    if "value" in df:
        print("  value range:", df["value"].min(), "→", df["value"].max())
