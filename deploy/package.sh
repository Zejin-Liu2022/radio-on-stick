#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

VERSION="$(python3 -c 'from app import __version__; print(__version__)')"
STAMP="$(date +%Y%m%d-%H%M)"
OUT_DIR="${ROOT_DIR}/dist"
ARCHIVE="${OUT_DIR}/radio-on-stick-${VERSION}-${STAMP}.tar.gz"

mkdir -p "${OUT_DIR}"
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "${STAGE_DIR}"' EXIT
PKG_ROOT="${STAGE_DIR}/radio-on-stick-${VERSION}"
mkdir -p "${PKG_ROOT}"
cp -a app deploy tools tests docs protocol directory AGENTS.md README.md .gitignore "${PKG_ROOT}/"
# Never package campus/private deployment notes, local CA, Mac helper scripts
# or unrelated prototypes, even when they are present in the working tree.
rm -rf   "${PKG_ROOT}/prototype"   "${PKG_ROOT}/docs/screenshots"   "${PKG_ROOT}/docs/CAMPUS.md"   "${PKG_ROOT}/docs/radio-campus-ca.crt"   "${PKG_ROOT}/deploy/macos-campus-start.sh"   "${PKG_ROOT}/deploy/macos-campus-stop.sh"   "${PKG_ROOT}/deploy/refresh-cernet-allow.py"
find "${PKG_ROOT}" -type d -name '__pycache__' -prune -exec rm -rf {} +
find "${PKG_ROOT}" -name '*.pyc' -delete
tar -C "${STAGE_DIR}" \
  -czf "${ARCHIVE}" \
  "radio-on-stick-${VERSION}"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "${OUT_DIR}" && sha256sum "$(basename "${ARCHIVE}")" >"$(basename "${ARCHIVE}").sha256")
fi

echo "已生成: ${ARCHIVE}"
if [[ -f "${ARCHIVE}.sha256" ]]; then
  echo "校验文件: ${ARCHIVE}.sha256"
fi
echo
echo "部署方式："
echo "  tar -xzf $(basename "${ARCHIVE}")"
echo "  cd radio-on-stick-*"
echo "  sudo bash deploy/install.sh"
