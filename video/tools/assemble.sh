#!/bin/zsh
# The recorded shots, end to end, as one movie.
#
#   zsh video/tools/assemble.sh <frames-dir> <out.mp4>
#
# The opening and the first part are one recording, and the second part's
# pages follow it straight on: the part's name coming down at the top of the
# frame is what marks the change, not a card between them.
set -e
frames=${1:?frames dir}
out=${2:?out.mp4}
here=${0:A:h}
swift $here/encode.swift $out 30 \
  $frames/film \
  $frames/site-estate $frames/site-stay $frames/site-outlets $frames/site-office $frames/site-cityhall $frames/site-hazard $frames/site-quake \
  $frames/outro
