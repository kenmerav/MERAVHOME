"""Generate fixed-weight PDF fonts from our licensed, unchanged source font.

Requires fonttools==4.61.1. Run from the repository root.
The original variable font remains available for browser invoice templates.
"""

from pathlib import Path
from shutil import copyfile

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


source = Path("public/invoice-assets/v1/PlayfairDisplay.ttf")
destination = Path("public/invoice-assets/v2")
destination.mkdir(parents=True, exist_ok=True)

for weight, style in [(400, "Regular"), (700, "Bold")]:
    font = instantiateVariableFont(TTFont(source), {"wght": weight}, inplace=True)
    # The OFL reserves the original family name; use a different primary name
    # for these derived fixed-weight fonts, retaining copyright/license records.
    names = {
        1: "Merav Invoice Serif",
        2: style,
        3: f"MeravInvoiceSerif-{style}-v2",
        4: f"Merav Invoice Serif {style}",
        6: f"MeravInvoiceSerif-{style}",
        16: "Merav Invoice Serif",
        17: style,
        21: "Merav Invoice Serif",
        22: style,
        25: "MeravInvoiceSerif",
    }
    for record in font["name"].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    font.save(destination / f"MeravInvoiceSerif-{style}.ttf")

copyfile(source.parent / "OFL.txt", destination / "OFL.txt")
