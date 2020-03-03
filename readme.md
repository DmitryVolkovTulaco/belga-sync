# Prezly Belga Sync

### Running

To run an instance of the container, run with a completed copy of `.env.example` to `/source/.env`, as follows:

```
docker run --volume ./.env:/source/.env belga-sync -- <belga_board_uuid> <prezly_newsroom_id> [belga_offset]
```
