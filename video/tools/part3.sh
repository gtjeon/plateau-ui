#!/bin/zsh
# The third part: five of the site's examples, eight seconds each, with a caption
# laid over and (where the example does not move by itself) a slow turn.
#
#   site running on 5181, then: zsh video/tools/part3.sh <frames-dir>
set -e
out=${1:?frames dir}
here=${0:A:h}
site=${SITE:-http://localhost:5181}
phrase='アイデアの土台に。'

shoot() {
  local id=$1 say=$2 api=$3 orbit=$4
  local arg="{\"say\":\"$say\",\"api\":\"$api\",\"phrase\":\"$phrase\",\"seconds\":8,\"corner\":\"right\"}"
  if [[ -n $orbit ]]; then
    node $here/record.mjs $site/src/examples/$id/index.html $out/$id --seconds 8 --inject $here/caption.js --arg $arg --orbit $orbit
  else
    node $here/record.mjs $site/src/examples/$id/index.html $out/$id --seconds 8 --inject $here/caption.js --arg $arg
  fi
}

shoot zilla '怪獣が歩くと、街が揺れる' 'buildings.animateAll(keyframes, { from })' ''
shoot flood-hours '浸水が続く時間を、高さで見せる' 'new ImageExtrusionTileLayer({ url, legend })' '820,430,-0.5,0'
shoot airstay '宿の 3D モデルを、地図に並べる' 'viewer.models.bring({ url, at })' '900,460,0.5,0'
shoot workspace '離れた駅を、ひとつの画面に' "mask: { shape: [circle, circle, …] }" '800,430,0.6,0'
shoot guide-map '道順を、地図の上に描く' 'new Polyline({ points })' '900,430,-0.5,0'
