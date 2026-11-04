# Homebrew cask for Vayun. To publish: create a GitHub repo named homebrew-vayun, put this file at
# Casks/vayun.rb, bump `version` for each release, and people can then run:
#   brew install --cask mukuls07/vayun/vayun
cask "vayun" do
  version "1.0.9"
  sha256 :no_check # replace with the universal dmg's SHA-256 (shasum -a 256) to pin it

  url "https://github.com/MukulS07/Vayun/releases/download/v#{version}/Vayun-#{version}-universal.dmg"
  name "Vayun"
  desc "Local-first notes, planners and an AI assistant"
  homepage "https://github.com/MukulS07/Vayun"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :big_sur"

  app "Vayun.app"

  # The app is not notarized by Apple, so clear the quarantine flag to let it open.
  postflight do
    system_command "/usr/bin/xattr", args: ["-cr", "#{appdir}/Vayun.app"]
  end

  zap trash: [
    "~/Library/Application Support/Pages",
    "~/Library/Preferences/com.vayun.desktop.plist",
  ]
end
