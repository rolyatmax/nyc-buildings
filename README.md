# nyc-buildings

### Sources

https://www.gis.bgu.tum.de/projekte/new-york-city-3d/
https://www1.nyc.gov/site/doitt/initiatives/3d-building.page

### Some numbers

The [`DA_WISE_GMLs` dataset](https://www1.nyc.gov/site/doitt/initiatives/3d-building.page) contains 20
GML files - altogether about 13.78GB unzipped. File numbers 12 and 13 contain all of Manhattan plus a small sliver of Queens and Roosevelt Island. The entire dataset contains 1083437 buildings, while the Manhattan portion contains about 47815 buildings (with 1219011 surfaces and 6198177 positions).

`DA12_3D_Buildings_Merged.gml` (bottom half of Manhattan) has 24038 buildings with 609730 surfaces (3049548 positions)
`DA13_3D_Buildings_Merged.gml` (top half of Manhattan) has 23777 buildings with 609281 surfaces (3148629 positions)

In combing through the data, I've found it's safe to make a couple assumptions:

* Each `core:cityObjectMember` has only one `bldg:Building`.
* Each `bldg:Building`'s `bldg:boundedBy` has exactly one of the following surfaces: `bldg:GroundSurface`, `bldg:RoofSurface`, `bldg:WallSurface`
* Each of these surface types will appear no more than once per `bldg:boundedBy` and will contain a key `bldg:lod2MultiSurface`
* There are no interior surfaces represented in this dataset
* I've only found LinearRings objects with positions

### Storage

One 32-bit float per vertex coord and for delimeters between surfaces and buildings gives us:
`1.2M surfaces + 0.05M buildings + 6M vertices * 3 dimensions == 19.25M 32bitFloats` and we
know that one pixel `(r, g, b, a)` is 32 bits in total. So this is the equivalent of a 19.25M
pixel image. That is about a 4388px x 4388px image.

### Ranges

`DA12_3D_Buildings_Merged.gml`:

```text
mins: [ 978979.241500825, 194479.073690146, -39.0158999999985 ]
maxs: [ 1002759.79006824, 220148.669988647, 1797.1066 ]
```

`DA13_3D_Buildings_Merged.gml`:

```text
mins: [ 985320.346272662, 219464.15495348, -1.5 ]
maxs: [ 1009996.30348232, 259992.617531568, 677.862299999993 ]
```

All of Manhattan (both files merged):

```text
mins: [ 978979.241500825, 194479.073690146, -39.0158999999985 ]
maxs: [ 1009996.30348232, 259992.617531568, 1797.1066 ]
range: [31017.061981495, 65513.543841422, 1836.1225]
```

### Compression

#### ~~One compression strategy~~

1. ~~subtract the min from each coord to bring it down to smaller numbers~~
2. ~~multiply each value by the order of magnitude you need for precision~~
3. ~~store the resulting value as an int?~~

**I don't think this will work as the range indicates that without step 2,
we're already extremely close to the Uint16 limit. If we can't get below
32 bits, we might as well just store as Float32s. :-/**

#### A second compression strategy

Dedupe all the vertices and then index into the vertices list with a separate
list just for buildings/surfaces.

Found 2047127 dupes out of 3049596 positions in `DA12_3D_Buildings_Merged.gml`.
Found 2112488 dupes out of 3148629 positions in `DA12_3D_Buildings_Merged.gml`.

A savings of about 67.1%!

**This begs the question: How many duplicate vertices are in the Manhattan dataset?**

#### A third compression strategy

For those buildings which are simple cuboids, we could define them just in
terms of a single `(x, y, z)` position + a `(width, depth, height)` triple.
If we're deduping vertices, this means we can store a building with 24 bytes
(`4 bytes * 6 32-bit floats`) instead of 128 bytes
(`4 bytes * (8 vertices * 3 coords + 8 indices)`). If we are _not_ deduping,
the savings is even bigger! We use 24 bytes instead of 288 bytes
(`4 bytes * 6 surfaces * 4 positions * 3 coords`).

**This begs the question: How many buildings of Manhattan are simple cuboids?**

SOME RAW OUTPUT, CLEAN ME UP LATER:
```
$ cat models/DA_WISE_GMLs/DA12_3D_Buildings_Merged.gml | node scripts/gml2obj.js

Buildings with one roof and one ground surface: 9688
out of total buildings: 24038
total positions of extrudable buildings 526386
can be reduced to just the roof positions: 87731
total positions period: 3049596

$ cat models/DA_WISE_GMLs/DA13_3D_Buildings_Merged.gml | node scripts/gml2obj.js

Buildings with one roof and one ground surface: 9500
out of total buildings: 23777
total positions of extrudable buildings 588558
can be reduced to just the roof positions: 98093
total positions period: 3148629
```
