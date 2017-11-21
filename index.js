/*
 Copyright © 2017 World Wide Web Consortium, (Massachusetts Institute of Technology,
 European Research Consortium for Informatics and Mathematics, Keio University, Beihang).
 All Rights Reserved.

 This work is distributed under the W3C® Software License [1] in the hope that it will
 be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

 [1] http://www.w3.org/Consortium/Legal/2002/copyright-software-20021231
*/

const io = require('./io-promise');
const aliases_engine = require('./aliases');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

var inputFile;

inputFile = process.argv[2];

if (inputFile === undefined) {
  console.error("[error] Missing input file");
  process.exit(1);
}


// output file
var outputFile = process.argv[3];

if (outputFile === undefined) {
  outputFile = inputFile + "-links.html";
}

// Return a promise with the pre-processed map
function readMapping() {
  var map = { variables : [], replace : [], warn: [], references: [], aliases: {} },
      mapFile = "link-map.txt";

  function addVariable(p, m) {
      map.variables.push([p, m]);
  }   
  function addReference(p, m) {
    map.references.push([p, m]);
  }
  function addReplace(p, m) {
    map.replace.push([new RegExp('"' + p + '"',"i"), new RegExp(p,"i"), m]);
  }
  function addAliases(n, p, m) {
    map.aliases[n] = [p, m];
  }

  return io.read(mapFile).then(data => {
    data.toString().split("\n").forEach((s) => {
      var vindex = -1;
      s = s.trim();
      map.variables.forEach((v) => {
        s = s.replace(new RegExp("\\$"  + v[0] + "\\$","g"), v[1]);
      });
      if (s.charAt(0) === "#" || s === "") {
        // comment or empty line , ignore
      } else if (s.indexOf("var:") === 0) {
        var ar = s.substr(4).split('=>');
        addVariable(ar[0].trim(), ar[1].trim());
      } else if (s.indexOf("ref:") === 0) {
        var ar = s.substr(4).split('=>');
        addReference(ar[0].trim(), ar[1].trim());
      } else if (s.indexOf("map:") === 0) {
        var ar = s.substr(4).split('=>');
        var comma = ar[0].indexOf(',');
        addAliases(ar[0].substr(0, comma).trim(), ar[0].substr(comma+1).trim(), ar[1].trim());
      } else if (s.indexOf("=>") !== -1) {
        var ar = s.split('=>');
        addReplace(ar[0].trim(), ar[1].trim());
      } else if (s.indexOf("warn:") === 0) {
        map.warn.push(s.substr(5));
      } else {
        console.warn("[WARNING] Ignored mapping line " + s);
      }
    });
    return map;
  }).then(map => {
    var refs = "";
    map.references.forEach(mapping => {
      refs += "," + mapping[1];
    });
    refs = refs.substr(1);
    
    return io.fetch("https://api.specref.org/bibrefs?refs="+refs).then(function (res) {
      return res.json();
    }).then(specrefs => {
      map.references.forEach(mapping => {
        var specref = specrefs[mapping[1]];
        while (specref !== undefined && specref.aliasOf !== undefined) {
          specref = specrefs[specref.aliasOf];
        }
        if (specref !== undefined && specref.title != undefined) {
          mapping[1] = specref;
        } else {
          console.log("specref.org : can't find " + mapping[1]);
        }
      });
      return map;
    });
  }).then(map => {
    var index = 0;
    var keys = [];
    for (var key in map.aliases) {
      keys.push(key);
    }
    function iter() {
      if (index === keys.length) return map;
      var key = keys[index++];
      var aliases = map.aliases[key];
      return aliases_engine.createMap(key, aliases[0], aliases[1]).then(data => {
        map.aliases[key] = data;
        return iter();          
      });
    }
    return iter();
  });
}

// Here we go

io.read(inputFile).then(text => {
  // read the mapping and apply it to the input
  return readMapping().then(map => {
    var dom = new JSDOM(text);
    var document = dom.window.document;
    var anchors = document.querySelectorAll("a");

    // do the aliasing first since it's the safest
    anchors.forEach(anchor => {
      var href = anchor.href;
      var changed = false;
      for (var mapKey in map.aliases) {
        if (!changed) {
          var alias = map.aliases[mapKey];
          if (href.indexOf(alias.origin) === 0) {
            // we have a map
            var index = href.indexOf('#');
            if (index != -1) {
              var id = href.substr(index + 1);
              var entry = alias.map[id];
              if (entry === undefined) {
                console.error("[WARNING] Unknown id " + id + " for " + alias.origin);
              } else if (entry.dest === undefined) {
                console.error("[WARNING] id " + id + " isn't present in " + alias.destination);
              } else {
                href = entry.dest;
                changed = true;
              }
            } else {
              if (href === alias.origin) {
                href = alias.origin;
                changed = true;
              } else {
                console.log("@@map " + href);
              }
            }
          }
        }
      }
      // this avoid settings about:blank in href
      if (changed) anchor.href = href;
    });

    anchors.forEach(anchor => {
      var href = anchor.href;
      var changed = false;
      map.replace.forEach(mapping => {
        // applying more than one regex on the same href allows for fallback mechanisms
        if (('"' + href + '"').search(mapping[0]) != -1) {
          href = href.replace(mapping[1], mapping[2]);
          changed = true;
        }
      });
      // this avoid settings about:blank in href
      if (changed) anchor.href = href;
    });
    var dts = document.querySelectorAll("dt");
    var references = {};
    dts.forEach(dt => {
      references[ dt.textContent.trim() ] = dt;
    })

    map.references.forEach(mapping => {
      var specref = mapping[1];
      var entry = '[' + mapping[0] + ']';
      var dt = references[entry];
      if (dt !== undefined) {
        var dd = dt.nextElementSibling;
        // clean up current dd
        var children = dd.childNodes;
        for (let index = children.length; index > 0;) {
          var child = children[--index];
          dd.removeChild(child);
        }
        // add content
        if (specref.authors !== undefined) {
          var authors = specref.authors[0];
          for (let index = 1; index < specref.authors.length; index++) {
            authors += ', ' + specref.authors[index];
          }
          dd.appendChild(document.createTextNode(authors + ". "));
        }
        var title = document.createElement('a');
        title.href = specref.href;
        title.appendChild(document.createTextNode(specref.title));
        dd.appendChild(title);
        dd.appendChild(document.createTextNode(". "));
        if (specref.date !== undefined) {
          dd.appendChild(document.createTextNode(specref.date + ". "));
        }
        if (specref.publisher !== undefined) {
          dd.appendChild(document.createTextNode(specref.publisher + ". "));
        }
        dd.appendChild(document.createTextNode("URL: "));
        title = document.createElement('a');
        title.href = specref.href;
        title.appendChild(document.createTextNode(specref.href));
        dd.appendChild(title);
      }
    });

    var warnings = {};
    anchors = document.querySelectorAll("a");
    anchors.forEach(anchor => {
      map.warn.forEach(warn_expression => {
        var reg_ex = new RegExp(warn_expression);
        if (anchor.href.search(reg_ex) != -1) {
          if (warnings[anchor.href] === undefined) {
            warnings[anchor.href] = [];
          }
          warnings[anchor.href].push(anchor);
        }
      });
    });
    for (var key in warnings) {
      console.warn("[WARNING] document contains " + key);
    }

    return dom;
  });
}).then(doc => {
  // save the processed text
  return io.save(outputFile, doc.serialize())
           .then(text => console.log(outputFile + " has been saved"));
}).catch(err => {
  console.error(err);
  process.exit(1);
});
