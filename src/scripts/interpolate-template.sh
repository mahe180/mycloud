#!/bin/bash

npm run gen:versioninfo

VALUE=$(./node_modules/.bin/sls print "$@")
if [ "$?" == "0" ]; then
  echo "$VALUE" > serverless-interpolated.yml
  cat serverless-interpolated.yml | node ./lib/scripts/yaml2json.js > src/serverless-interpolated.json
  cp src/serverless-interpolated.json lib/
else
  >&2 echo "$VALUE"
fi
