
    window.onload = function hello() {

        var timeoutHandle=0;
        var longClicked=false;

        var longClickDelay=500;         // number of ms until it's a long-click.

        document.querySelectorAll('div.codes span.code').forEach(code => {
            // Desktop events:
            code.addEventListener('mousedown', beginClick);
            code.addEventListener('mouseup', endClick);

            // Mobile events:
            code.addEventListener('touchstart', beginClick);
            code.addEventListener('touchend', endClick);
        });



        // Start click/touch:
        function beginClick(e) {
            timeoutHandle=setTimeout(longClick, longClickDelay, e.target);
            longClicked=false;
        }



        // If we've long-pressed:
        function longClick(code) {
            longClicked=true;

            // Create a <form> with an <input>
            var form=document.createElement('form');
            form.action=code.getAttribute('xhref');
            form.method='POST';

            var input=document.createElement('input');
            input.type='text';
            input.name='note';
            input.placeholder='Notes';

            form.appendChild(input);

            // Replace the <span> with this <form>:
            code.replaceWith(form);

            // Hide all the other buttons:
            document.querySelectorAll('div.codes span.code').forEach(span => {
                span.style.display='none';
            });

            // Set focus on the <input>:
            document.querySelectorAll('div.codes input')[0].focus();
        }



        // End of click/touch, but not long-press:
        function endClick(e) {
            if (!longClicked) {
                clearTimeout(timeoutHandle);

                // Just go to the URL we assigned to the button:
                window.location.assign(e.target.getAttribute('xhref'));
            }
        }

    }
