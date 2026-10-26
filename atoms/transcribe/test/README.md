# transcribe tests

`test.sh` runs offline once the model weights are cached.

`fixtures/hello-pink-tail.m4a` is `fixtures/hello.aiff` followed by quiet pink noise, 33.997 seconds of audio in all. Its final 30-second window holds only noise, and whisper.cpp writes a "Thank you." segment there that ends at 59.98 s. The test asserts every segment ends by 33.99 s. ffmpeg 9.0.1 rebuilds it byte for byte:

```
ffmpeg -i fixtures/hello.aiff -f lavfi -t 32.55 -i 'anoisesrc=r=16000:a=0.005:c=pink:s=7' \
	-filter_complex '[1]aformat=channel_layouts=mono:sample_rates=16000[n];[0]aformat=channel_layouts=mono:sample_rates=16000[s];[s][n]concat=n=2:v=0:a=1' \
	-c:a aac -b:a 24k fixtures/hello-pink-tail.m4a
```
