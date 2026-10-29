abi <abi/4.0>,
include <tunables/global>

profile make-it-studio /opt/Make\ it\ Studio/make-it-studio flags=(unconfined) {
  userns,
  include if exists <local/make-it-studio>
}
