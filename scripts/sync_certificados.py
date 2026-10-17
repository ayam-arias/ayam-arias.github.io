"""Publica en el sitio los certificados nuevos de la carpeta de capacitaciones
y los agrega a los documentos madre (ver documentos.py).

Uso:  python scripts/sync_certificados.py [--dry-run] [--no-push]

Detecta PDFs nuevos por contenido (hash), así que renombrar o mover un PDF no lo duplica.
Para que un PDF nunca se publique, agrega su hash a scripts/ignorados.txt.
"""
import datetime, hashlib, json, os, re, shutil, subprocess, sys, unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import documentos

REPO = Path(__file__).resolve().parent.parent
SRC = Path(os.environ.get("CAPACITACIONES", Path.home() / "OneDrive/Documentos/01_CAPACITACIONES"))
CERTS_DIR, CERTS_JSON, CV_JSON = REPO / "certificados", REPO / "data/certificados.json", REPO / "data/cv.json"
IGNORADOS = REPO / "scripts/ignorados.txt"
MESES = "Enero Febrero Marzo Abril Mayo Junio Julio Agosto Septiembre Octubre Noviembre Diciembre".split()


def sha1(p):
    return hashlib.sha1(p.read_bytes()).hexdigest()


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def area(folder):
    return re.sub(r"^\d+\s+", "", folder)


def common_prefix(names):
    words = [n.split() for n in names]
    out = []
    for col in zip(*words):
        if len(set(col)) > 1:
            break
        out.append(col[0])
    return out


def parse(stem, learned):
    """'ESRI Fundamentos de SIG - 20 h.' -> (titulo, institucion, horas)."""
    horas = None
    try:  # nombres extraídos de .zip a veces quedan como "pol├¡tica"
        stem = stem.encode("cp437").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    m =re.search(r"\s*-\s*(\d+)\s*h\.?\s*$", stem)
    if m:
        horas, stem = int(m.group(1)), stem[: m.start()]
    first = stem.split()[0]
    if first in learned:
        inst, samples = learned[first]
        # shortcut: con un solo ejemplo conocido se asume prefijo de una palabra; revisar si la institución tiene nombre de varias palabras
        n = len(common_prefix(samples)) if len(samples) > 1 else 1
        return " ".join(stem.split()[n:]).strip(), inst, horas
    if stem.startswith("Diplomado"):
        return stem.strip(), "", horas
    if first.isupper() and len(first) <= 12:  # sigla desconocida: se usa como institución
        return stem[len(first):].strip(), first, horas
    return stem.strip(), "", horas


def main():
    dry, push = "--dry-run" in sys.argv, "--no-push" not in sys.argv
    certs = json.loads(CERTS_JSON.read_text(encoding="utf-8"))
    cv = json.loads(CV_JSON.read_text(encoding="utf-8"))
    by_file = {c["archivo"]: c for c in certs}
    publicados = {sha1(p): p.name for p in CERTS_DIR.glob("*.pdf")}
    ignorados = {l.split()[0] for l in IGNORADOS.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")} if IGNORADOS.exists() else set()

    fuentes = {}  # hash -> [rutas]
    for p in sorted(SRC.rglob("*.pdf")):
        fuentes.setdefault(sha1(p), []).append(p)

    # Aprende "sigla del nombre de archivo -> institución" de los certificados ya publicados.
    learned = {}
    for h, rutas in fuentes.items():
        c = by_file.get(publicados.get(h))
        if c and c.get("institucion"):
            first = rutas[0].stem.split()[0]
            learned.setdefault(first, [c["institucion"], []])[1].append(rutas[0].stem)

    def describir(rutas):
        rels = [r.relative_to(SRC) for r in rutas]
        titulo, inst, horas = parse(rutas[0].stem, learned)
        carpetas = list(dict.fromkeys(r.parts[0] for r in rels))
        en_dip = any("DIPLOMADOS" in r.parts for r in rels) or titulo.startswith("Diplomado")
        en_titulos = all(len(r.parts) == 2 and r.parts[0].startswith("00") for r in rels)
        return {"titulo": titulo, "inst": inst, "horas": horas, "carpetas": carpetas,
                "areas": [area(c) for c in carpetas], "ruta": str(rutas[0]),
                "tipo": "diplomado" if en_dip else "titulo" if en_titulos else "curso",
                # shortcut: la fecha es la del archivo, no la impresa en el certificado
                "fecha": datetime.date.fromtimestamp(rutas[0].stat().st_mtime).strftime("%d-%m-%Y")}

    try:  # los documentos son locales: un error aquí no debe frenar la publicación web
        documentos.actualizar(fuentes, describir, dry)
    except Exception as e:
        print(f"Documentos: ERROR {e!r}; no se modificaron o quedaron a medias (hay respaldo en _respaldos).")

    titulos = {slug(c["titulo"]) for c in certs}
    nuevos = []
    for h, rutas in fuentes.items():
        if h in publicados or h in ignorados:
            continue
        it = describir(rutas)
        # el mismo curso puede llegar como otro PDF (otros bytes): se evita duplicarlo por título
        if slug(it["titulo"]) in titulos:
            print(f"= {it['titulo']}: ya publicado con otro PDF; se omite (agrega su hash a ignorados.txt para silenciar).")
            continue
        archivo =slug(f"{it['titulo']} {it['inst']}")[:110] + ".pdf"
        while archivo in by_file or (CERTS_DIR / archivo).exists():
            archivo = archivo[:-4] + "-2.pdf"
        entry = {"titulo": it["titulo"], "institucion": it["inst"], "horas": it["horas"], "areas": it["areas"],
                 "archivo": archivo, "tipo": it["tipo"], "agregado": datetime.date.today().isoformat()}
        nuevos.append((rutas[0], entry))
        by_file[archivo] = entry
        print(f"+ {entry['titulo']} | {it['inst'] or '(sin institución)'} | {it['horas'] or '-'} h | {it['tipo']} | {', '.join(it['areas'])}")

    if not nuevos:
        print("Sin certificados nuevos.")
        return
    if dry:
        print(f"(dry-run) {len(nuevos)} certificado(s) nuevo(s), no se modificó nada.")
        return

    hoy = datetime.date.today()
    for ruta, e in nuevos:
        shutil.copy2(ruta, CERTS_DIR / e["archivo"])
        certs.append(e)
        if e["tipo"] == "diplomado" and not any(d["titulo"] == e["titulo"] for d in cv["formacion"]["diplomados"]):
            cv["formacion"]["diplomados"].insert(0, {"titulo": e["titulo"], "institucion": e["institucion"], "horas": e["horas"], "anio": str(hoy.year)})
    cv["actualizado"] = f"{MESES[hoy.month - 1]} {hoy.year}"
    CERTS_JSON.write_text(json.dumps(certs, ensure_ascii=False, indent=1), encoding="utf-8")
    CV_JSON.write_text(json.dumps(cv, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    git = lambda *a: subprocess.run(["git", "-C", str(REPO), *a], check=True)
    git("add", "certificados", "data")
    git("commit", "-m", f"Agrega {len(nuevos)} certificado(s): " + "; ".join(e["titulo"] for _, e in nuevos)[:200])
    if push:
        git("pull", "--rebase")
        git("push")
    print(f"Publicados {len(nuevos)} certificado(s).")


if __name__ == "__main__":
    assert slug("Geomática y SIG (AEC)") == "geomatica-y-sig-aec"
    assert parse("Diplomado en X - 80 h.", {}) == ("Diplomado en X", "", 80)
    assert parse("UCH Herramientas de IA", {}) == ("Herramientas de IA", "UCH", None)
    assert parse("LinkedIn Learning Curso A", {"LinkedIn": ["LinkedIn Learning", ["LinkedIn Learning B", "LinkedIn Learning C"]]}) == ("Curso A", "LinkedIn Learning", None)
    main()
