#!/usr/bin/env python3
"""Extract the 2022-2024 Great Britain tables from the ONS XLSX workbook."""

import argparse
import csv
import posixpath
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "office": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "package": "http://schemas.openxmlformats.org/package/2006/relationships",
}
FIELDS = ("mx", "qx", "lx", "dx", "ex")


def _column_index(cell_reference):
    letters = re.match(r"[A-Z]+", cell_reference).group(0)
    index = 0
    for letter in letters:
        index = index * 26 + ord(letter) - ord("A") + 1
    return index


def _shared_strings(archive):
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return ["".join(text.text or "" for text in item.iter(f"{{{NS['main']}}}t"))
            for item in root.findall("main:si", NS)]


def _cell_value(cell, shared_strings):
    value = cell.findtext("main:v", namespaces=NS)
    if value is None:
        return None
    if cell.get("t") == "s":
        return shared_strings[int(value)]
    if cell.get("t") in ("str", "inlineStr"):
        return value
    try:
        return float(value)
    except ValueError as error:
        raise ValueError(f"Non-numeric table value {value!r}") from error


def read_table(workbook_path):
    with zipfile.ZipFile(workbook_path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {item.get("Id"): item.get("Target")
                   for item in relationships.findall("package:Relationship", NS)}
        target_id = next(
            (sheet.get(f"{{{NS['office']}}}id")
             for sheet in workbook.findall("main:sheets/main:sheet", NS)
             if sheet.get("name") == "2022-2024"),
            None,
        )
        if target_id is None or target_id not in targets:
            raise ValueError("Workbook does not contain the required 2022-2024 sheet")

        target = targets[target_id].lstrip("/")
        sheet_path = target if target.startswith("xl/") else posixpath.join("xl", target)
        sheet = ET.fromstring(archive.read(sheet_path))
        shared_strings = _shared_strings(archive)
        rows = sheet.findall(".//main:sheetData/main:row", NS)

    table = {}
    for row in rows:
        cells = {}
        for cell in row.findall("main:c", NS):
            cells[_column_index(cell.get("r"))] = _cell_value(cell, shared_strings)

        male_headers = [cells.get(index) for index in range(1, 7)]
        female_headers = [cells.get(index) for index in range(8, 14)]
        expected_headers = ["age", *FIELDS]
        if male_headers == expected_headers and female_headers == expected_headers:
            header_row = int(row.get("r"))
            break
    else:
        raise ValueError("Could not find both age/mx/qx/lx/dx/ex table headers")

    for row in rows:
        if int(row.get("r")) <= header_row:
            continue
        cells = {}
        for cell in row.findall("main:c", NS):
            cells[_column_index(cell.get("r"))] = _cell_value(cell, shared_strings)
        if not isinstance(cells.get(1), (int, float)) or not isinstance(cells.get(8), (int, float)):
            continue
        male_age, female_age = int(cells[1]), int(cells[8])
        if male_age != female_age:
            raise ValueError(f"Sex-specific ages differ on worksheet row {row.get('r')}")
        values = {"age": male_age}
        for prefix, start in (("male", 2), ("female", 9)):
            for offset, field in enumerate(FIELDS):
                value = cells.get(start + offset)
                if not isinstance(value, (int, float)):
                    raise ValueError(f"Missing {prefix} {field} at age {male_age}")
                values[f"{prefix}_{field}"] = value
        table[male_age] = values

    expected_ages = list(range(101))
    if sorted(table) != expected_ages:
        raise ValueError("The 2022-2024 sheet must contain exactly ages 0 through 100")
    for sex in ("male", "female"):
        prior_lx = None
        for age in expected_ages:
            row = table[age]
            if any(row[f"{sex}_{field}"] < 0 for field in FIELDS):
                raise ValueError(f"Negative {sex} value at age {age}")
            lx = row[f"{sex}_lx"]
            if prior_lx is not None and lx > prior_lx:
                raise ValueError(f"{sex} lx increases at age {age}")
            prior_lx = lx
    return [table[age] for age in expected_ages]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    rows = read_table(args.workbook)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["age"] + [f"{sex}_{field}" for sex in ("male", "female") for field in FIELDS]
    with args.output.open("w", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Extracted {len(rows)} ages to {args.output}")


if __name__ == "__main__":
    main()