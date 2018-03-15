# nyc-buildings

## Some numbers

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
