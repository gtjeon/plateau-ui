#!/bin/zsh
# Records every shot of the video, one after another (never two at once: they
# share the GPU, and two headless browsers at once have stalled a recording).
#
#   video server running (port 5190), then: zsh video/tools/all.sh <frames-dir>
set -e
out=${1:?frames dir}
here=${0:A:h}
base=${VIDEO:-http://localhost:5190}/video/shots
rec() { node $here/record.mjs "$@" > $out/$(basename $2).log 2>&1; echo "$(basename $2) $?"; }
mkdir -p $out

rec $base/film/index.html $out/film
# The pages are shown at 0.883 of the frame, 74.7 px in and 60 px down, so the
# drag on each map is set where the map is now, and as far in the map's pixels
rec "$base/site/index.html?page=estate" $out/site-estate
rec "$base/site/index.html?page=stay" $out/site-stay --orbit 463,440,0.44,0
rec "$base/site/index.html?page=outlets" $out/site-outlets --orbit 479,448,0.44,0
rec "$base/site/index.html?page=office" $out/site-office --orbit 825,413,0.53,0
rec "$base/site/index.html?page=cityhall" $out/site-cityhall --orbit 472,457,-0.44,0
rec "$base/site/index.html?page=hazard" $out/site-hazard --orbit 649,457,-0.44,0
rec "$base/site/index.html?page=quake" $out/site-quake
rec $base/outro/index.html $out/outro
echo done
