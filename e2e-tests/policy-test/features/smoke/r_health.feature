set smoke_read to "ok"
variable smoke_read is "ok"

variable THIS_PLACE exists
variable BASE_URL exists

where variable THIS_PLACE is "local", variable BASE_URL is "http://localhost:8123"
where variable THIS_PLACE is "prod", variable BASE_URL is "https://production.com"
where variable THIS_PLACE is "prod", variable TIMEOUT is "5000"
