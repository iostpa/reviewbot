# Pull Request Merged :tada:

## What to do next

Just follow the steps below and you can start using your domain!

### GitHub Pages

1. Go to your GitHub repository that you use for your is-a.dev domain
2. Click on the Settings tab
3. Click on the Pages link in the sidebar
4. In the custom domain option, enter the domain you registered.
5. Check the Enforce HTTPS checkbox
6. Give your domain some time (~24 hours) for the changes to propagate
7. Enjoy your domain!
    
### Vercel

You may have to verify the domain so that you can succesfully add the domain to your Vercel website, if you have done that by now then the domain should already be connected! If it hasn't, go to the Domain section and click on "Refresh" to see if it works.

### Cloudflare Pages

If you haven't done this by now, you need to add the is-a.dev domain to your Cloudflare Pages website. To do so, navigate to your settings for the website, click on "Custom domains", **click on "Add a custom domain" instead of the other option as it will make you use NS records so that the domain can be on Cloudflare DNS**, add the is-a.dev domain that you got and you are done!

### Other hosting providers

Just make sure you have added the domain to your website. Try to see if there is a guide for your hosting provider at [our documentation](https://docs.is-a.dev/) to see how you can configure it. It's also a good idea to see your hosting providers' documentation to see how you can add a custom domain.

### Webserver (like NGINX, Caddy, Apache and etc.)

You have to add these in your webserver config by yourself. If you don't know how to add a domain to your webserver then either use a different method of hosting your website or search on a search engine on how to use the said webserver.

Need help with your domain? If you have some trouble setting up your domain, please create an issue or ask in the [Discord server](https://discord.gg/is-a-dev-830872854677422150) and we will try and help you as soon as possible!
Made a mistake in the records? Don't worry, you can create a new pull request with the corrections.

Thanks for reading the message and thanks for using is-a.dev! :heart: