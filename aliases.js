const io = require('./io-promise');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

// that's our exposed module
var mod = {};

function fetchIds(url) {
  console.log(" fetching " + url);
  return io.fetch(url)
  .then(res => res.text())
  .then(res => new JSDOM(res))
  .then(dom => dom.window.document)
  .then(document => {
    var ids = [];
    document.querySelectorAll("*[id]").forEach(el => ids.push(el.id));
    return ids;
  });;
}
function fetchOriginIds(url) {
  return fetchIds(url)
  .then(l => {
    var ids = {};
    l.forEach(el => ids[el] = { origin: url + '#' + el, id: el});
    return ids;
  });
}

function mapDestIds(url, ids) {
  return fetchIds(url)
  .then(l => {
    l.forEach(el => {
      var id = ids[el];
      if (id !== undefined) {
        if (id.origin === undefined) throw new Error("hu? " + id);
        id.dest = url + '#' + el;
      }
    });
    return ids;
  });
}

mod.createMap = function (alias, orig, dest) {
  var outputData = "data/" + alias + ".json";
  return io.read(outputData)
   .then(JSON.parse)
   .catch(e => {
     console.log("[info] creating map for " + alias);
     return fetchOriginIds(orig).then(map_orig => mapDestIds(dest, map_orig)).then(map => {
       var obj = { name: alias, origin: orig, destination: dest, map: map };
       console.log("[info] saving map for " + alias);
       return io.save(outputData, obj);
     });
    });
}

// test

// mod.createMap("webidl", "https://heycam.github.io/webidl/", "https://www.w3.org/TR/WebIDL-1/").then(map => {
//  console.log("Found " + map.name);
// }).catch(e => console.log(e));

// End of module
module.exports = mod;
