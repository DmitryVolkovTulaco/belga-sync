# Prezly Belga Sync

### Running

To run an instance of the container, run with a completed copy of `.env.example` mounted to `/source/.env`, as follows:

```
docker run --volume ./.env:/source/.env belga-sync -- import <belga_board_uuid> <prezly_newsroom_id> [belga_offset]
```

Alternatively, you may also provide the values via environment.
