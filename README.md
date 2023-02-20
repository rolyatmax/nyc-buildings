# All the Buildings in New York

First:

```sh
$ cd lib/process-buildings
$ cargo build --release
$ cp target/release/process-buildings ../../
```

To process data:

```sh
$ process-buildings [FILES] > output.bin
```

Or to read the header of a processed file:

```sh
$ process-buildings --info [FILE]
```
